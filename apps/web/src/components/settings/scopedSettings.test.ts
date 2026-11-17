import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Cause from "effect/Cause";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE } from "./roleDelegationModes";
import {
  applyPendingScopedWrites,
  createScopedSettingsWriter,
  persistScopedSettingsPatch,
  planProjectOverridesClear,
  planScopedSettingsClear,
  planScopedSettingsPatch,
  scopedIdleCompaction,
  resolveScopedSettingsTargets,
  scopedRolesUnsupportedLabels,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  selectScopedSettingsEnvironments,
  settlePendingScopedWrites,
  type PendingScopedWrite,
} from "./scopedSettings";
import { resolveSettingsScope } from "./settingsScope";

function agentRoleDefaults(security?: string) {
  return {
    architecture: "Architecture",
    implementation: "Implementation",
    research: "Research",
    review: "Review",
    design: "Design",
    test: "Test",
    general: "General",
    ...(security === undefined ? {} : { security }),
  };
}

function environment(
  id: string,
  options: {
    connected?: boolean;
    loaded?: boolean;
    settings?: Partial<ServerSettings>;
    agentRoleInstructionDefaults?: ReturnType<typeof agentRoleDefaults>;
    supportsAgentRoleDelegationModes?: boolean;
  } = {},
) {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    connection: {
      phase: options.connected === false ? ("offline" as const) : ("connected" as const),
    },
    serverConfig:
      options.loaded === false
        ? null
        : {
            settings: { ...DEFAULT_SERVER_SETTINGS, ...options.settings },
            ...(options.agentRoleInstructionDefaults === undefined
              ? {}
              : { agentRoleInstructionDefaults: options.agentRoleInstructionDefaults }),
            ...(options.supportsAgentRoleDelegationModes === undefined
              ? {}
              : { supportsAgentRoleDelegationModes: options.supportsAgentRoleDelegationModes }),
          },
  };
}

const laptop = environment("Laptop");
const server = environment("Server");
const offline = environment("Offline", { connected: false });
const loading = environment("Loading", { loaded: false });
const environments = [laptop, server, offline, loading];
const all = resolveSettingsScope({}, [], environments);
const named = resolveSettingsScope({ machine: server.environmentId }, [], environments);

const projectId = ProjectId.make("project");
const laptopProjectId = ProjectId.make("laptop-project");
const member = {
  id: projectId,
  environmentId: server.environmentId,
  title: "Project",
  workspaceRoot: "/repo",
  physicalProjectKey: `${server.environmentId}:/repo`,
  environmentLabel: server.label,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};
const laptopMember = {
  ...member,
  id: laptopProjectId,
  environmentId: laptop.environmentId,
  physicalProjectKey: `${laptop.environmentId}:/repo`,
  environmentLabel: laptop.label,
};
const group: SidebarProjectSnapshot = {
  ...member,
  projectKey: "project-group",
  displayName: "Project",
  memberProjects: [member, laptopMember],
  memberProjectRefs: [
    { environmentId: server.environmentId, projectId },
    { environmentId: laptop.environmentId, projectId: laptopProjectId },
  ],
  groupedProjectCount: 2,
  environmentPresence: "remote-only",
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  remoteEnvironmentLabels: [server.label, laptop.label],
  pinned: false,
  archived: false,
};
const project = resolveSettingsScope({ project: group.projectKey }, [group], environments);
const checkout = resolveSettingsScope(
  { project: group.projectKey, machine: server.environmentId, checkout: member.physicalProjectKey },
  [group],
  environments,
);

describe("scoped settings targets", () => {
  it("uses the named environment even when a different primary is available", () => {
    const selected = selectScopedSettingsEnvironments(named, environments, laptop.environmentId);
    expect(selected.environments).toEqual([server]);
    expect(selected.environment).toBe(server);
  });

  it("keeps an offline named environment selected without falling back to primary", () => {
    const scope = resolveSettingsScope({ machine: offline.environmentId }, [], environments);
    const selected = selectScopedSettingsEnvironments(scope, environments, laptop.environmentId);
    expect(selected.environments).toEqual([offline]);
    expect(selected.connectedEnvironments).toEqual([]);
    expect(selected.environment).toBeNull();
    expect(
      planScopedSettingsPatch(scope, environments, { enableProviderUpdateChecks: false }),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: "Connect Offline to save this setting.",
    });
  });

  it("resolves each member's effective settings and source at project scope", () => {
    const overridden = environment("Server", {
      settings: {
        defaultAutoPull: false,
        projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
      },
    });
    const targets = resolveScopedSettingsTargets(project, [laptop, overridden]);
    expect(targets.map((target) => [target.projectId, target.settings.defaultAutoPull])).toEqual([
      [projectId, true],
      [laptopProjectId, false],
    ]);
    expect(scopedSettingsSource(targets, ["defaultAutoPull"])).toBe("mixed");
    expect(scopedSettingsSource([targets[0]!], ["defaultAutoPull"])).toBe("project");
    expect(scopedSettingsSource(targets, ["enableProviderUpdateChecks"])).toBe("environment");
    expect(scopedSettingsAreMixed(targets, ["defaultAutoPull"])).toBe(true);
  });
});

describe("role support across selected targets", () => {
  function unsupportedLabels(selected: ReadonlyArray<ReturnType<typeof environment>>) {
    return scopedRolesUnsupportedLabels(
      resolveScopedSettingsTargets(resolveSettingsScope({}, [], selected), selected),
      selected,
    );
  }

  it("supports roles on servers that advertise them, with or without the security role", () => {
    const roles = environment("Modern", {
      agentRoleInstructionDefaults: agentRoleDefaults("Security text."),
    });
    const eightRole = environment("Earlier", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
    });
    expect(unsupportedLabels([roles])).toEqual([]);
    expect(unsupportedLabels([eightRole])).toEqual([]);
  });

  it("names an environment whose loaded server config has no role settings", () => {
    expect(unsupportedLabels([environment("Older")])).toEqual(["Older"]);
  });

  it("names only the older environment in a mixed scope", () => {
    const roles = environment("Modern", {
      agentRoleInstructionDefaults: agentRoleDefaults("Security text."),
    });
    expect(unsupportedLabels([roles, environment("Older")])).toEqual(["Older"]);
  });

  it("does not name an environment whose server config has not loaded", () => {
    expect(unsupportedLabels([environment("Connecting", { loaded: false })])).toEqual([]);
  });
});

describe("scoped settings writes", () => {
  it("edits the effective machine policy without changing other machines' rules", () => {
    const custom = environment("Laptop", {
      settings: {
        worktreeCleanup: {
          mode: "custom",
          rules: {
            worktreeAfterDays: 12,
            worktreeSettledAfterDays: null,
            worktreeOnDelete: true,
            worktreeOnMerge: true,
            worktreeUnchanged: false,
            worktreeKeepWhen: "uncommitted-changes",
          },
        },
      },
    });
    const disabled = environment("Server", {
      settings: { worktreeCleanup: { mode: "off" } },
    });
    const targets = [custom, disabled];
    const plan = planScopedSettingsPatch(all, targets, {
      storageCleanup: { worktreeOnDelete: false },
    });
    const policies = plan.serverWrites.map((write, index) =>
      resolveWorktreeCleanup(
        applyServerSettingsPatch(targets[index]!.serverConfig!.settings, write.patch),
        null,
      ),
    );
    expect(policies).toEqual([
      {
        worktreeAfterDays: 12,
        worktreeSettledAfterDays: null,
        worktreeOnDelete: false,
        worktreeOnMerge: true,
        worktreeUnchanged: false,
        worktreeKeepWhen: "uncommitted-changes",
      },
      {
        worktreeAfterDays: null,
        worktreeSettledAfterDays: null,
        worktreeOnDelete: false,
        worktreeOnMerge: false,
        worktreeUnchanged: false,
        worktreeKeepWhen: "uncommitted-changes",
      },
    ]);
  });

  it("compares idle compaction by mode, and offers Never only where every server stores it", () => {
    const fixed = {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        compactIdleThreads: false,
        idleCompaction: "onReturn" as const,
      },
    };
    const modes = {
      settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: "onReturn" as const },
    };
    const legacy = { settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: false } };
    expect(scopedIdleCompaction([fixed, modes])).toEqual({ mixed: false, neverAvailable: true });
    expect(scopedIdleCompaction([fixed, legacy])).toEqual({ mixed: false, neverAvailable: false });
    const legacyEnvironment = environment("Legacy", { settings: legacy.settings });
    const projected = applyPendingScopedWrites(
      [legacyEnvironment],
      [
        {
          save: {},
          environmentId: legacyEnvironment.environmentId,
          patch: { defaultRuntimeMode: "auto" },
        },
      ],
    );
    expect(scopedIdleCompaction(resolveScopedSettingsTargets(all, projected)).neverAvailable).toBe(
      false,
    );
    expect(
      scopedIdleCompaction([fixed, { settings: { ...fixed.settings, idleCompaction: "off" } }])
        .mixed,
    ).toBe(true);
  });

  it("sends an idle compaction mode in the form each environment's server reads", () => {
    const targets = [
      environment("Fixed", { settings: { compactIdleThreads: false, idleCompaction: "onReturn" } }),
      environment("Modes", { settings: { compactIdleThreads: "onReturn" } }),
      environment("Switch", { settings: { compactIdleThreads: false } }),
    ];
    const plan = planScopedSettingsPatch(resolveSettingsScope({}, [], targets), targets, {
      idleCompaction: "beforeCacheExpires",
    });
    expect(plan.serverWrites.map((write) => write.patch)).toEqual([
      { idleCompaction: "beforeCacheExpires" },
      { compactIdleThreads: "beforeCacheExpires" },
      { compactIdleThreads: true },
    ]);
  });

  it("writes an aggregate preference only to connected environments with loaded configuration", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(all, environments, { enableProviderUpdateChecks: false }),
      persistServer,
      persistClient,
    );
    expect(persistServer.mock.calls.map(([input]) => input.environmentId)).toEqual([
      laptop.environmentId,
      server.environmentId,
    ]);
    expect(persistClient).not.toHaveBeenCalled();
  });

  describe("an environment that saves but drops keys it does not know", () => {
    const upgradedLaptop = (saved: Partial<ServerSettings>) =>
      vi.fn(async ({ environmentId }: { environmentId: EnvironmentId }) => ({
        _tag: "Success" as const,
        value: {
          ...DEFAULT_SERVER_SETTINGS,
          ...(environmentId === laptop.environmentId ? saved : {}),
        },
      }));
    const outcome = async (
      plan: ReturnType<typeof planScopedSettingsPatch>,
      persistServer: ReturnType<typeof upgradedLaptop>,
    ) => {
      const result = await persistScopedSettingsPatch(plan, persistServer, vi.fn());
      return {
        saved: result.savedEnvironments.map(({ label }) => label),
        failed: result.failedEnvironments.map(({ label, message }) => ({ label, message })),
      };
    };
    const unsupported = [
      {
        label: server.label,
        message: "This environment does not support this setting. Update T3 Code on it.",
      },
    ];

    it("reports a dropped toggle", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, environments, { reviewGuidesEnabled: true }),
          upgradedLaptop({ reviewGuidesEnabled: true }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    it("reports dropped text but accepts the server trimming it", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, environments, { reviewGuideInstructions: " Read tests " }),
          upgradedLaptop({ reviewGuideInstructions: "Read tests" }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    // regression: #18334 an environment silently dropped a setting with no warning
    it("reports a dropped key inside a project override", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(project, environments, { defaultAutoPull: true }),
          upgradedLaptop({
            projectSettingsOverrides: { [laptopProjectId]: { defaultAutoPull: true } },
          }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    it("accepts a write that matches what the environment already had", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, environments, { reviewGuidesEnabled: false }),
          upgradedLaptop({}),
        ),
      ).toEqual({ saved: [laptop.label, server.label], failed: [] });
    });
  });

  it("persists client keys locally at any scope alongside server keys", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(named, environments, {
        diffIgnoreWhitespace: false,
        enableProviderUpdateChecks: false,
      }),
      persistServer,
      persistClient,
    );
    expect(persistClient).toHaveBeenCalledExactlyOnceWith({ diffIgnoreWhitespace: false });
    expect(persistServer).toHaveBeenCalledExactlyOnceWith({
      environmentId: server.environmentId,
      input: { patch: { enableProviderUpdateChecks: false } },
    });
  });

  it("writes project overrides into each member's entry on its environment", () => {
    const withExisting = environment("Server", {
      settings: {
        projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } },
      },
    });
    const plan = planScopedSettingsPatch(project, [laptop, withExisting], {
      defaultAutoPull: true,
    });
    expect(plan.unavailableReason).toBeNull();
    expect(plan.serverWrites).toEqual([
      {
        environmentId: server.environmentId,
        label: server.label,
        previous: expect.anything(),
        patch: {
          projectSettingsOverrides: {
            [projectId]: { enableAgentBrowserAccess: false, defaultAutoPull: true },
          },
        },
      },
      {
        environmentId: laptop.environmentId,
        label: laptop.label,
        previous: expect.anything(),
        patch: { projectSettingsOverrides: { [laptopProjectId]: { defaultAutoPull: true } } },
      },
    ]);
    expect(
      planScopedSettingsPatch(checkout, [laptop, server], { defaultAutoPull: true }),
    ).toMatchObject({
      serverWrites: [{ environmentId: server.environmentId }],
    });
  });

  it("merges project role overrides per role and leaves inherited roles out of the entry", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const architecture = { instanceId: claude, model: "opus-5" };
    const review = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };
    const implementation = { instanceId: claude, model: "sonnet-5" };
    const withRoles = environment("Server", {
      settings: {
        agentRoleModels: { architecture },
        projectSettingsOverrides: { [projectId]: { agentRoleModels: { review } } },
      },
    });
    const plan = planScopedSettingsPatch(project, [withRoles], {
      agentRoleModels: { implementation },
    });
    expect(plan.serverWrites).toHaveLength(1);
    expect(plan.serverWrites[0]?.patch).toEqual({
      projectSettingsOverrides: {
        [projectId]: { agentRoleModels: { review, implementation } },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withRoles], {
        agentRoleModels: { review: null },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: { [projectId]: {} },
    });
    expect(
      planScopedSettingsPatch(project, [withRoles], {
        agentRoleModels: { review: { instanceId: claude, model: "opus-5" } },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          agentRoleModels: { review: { instanceId: claude, model: "opus-5" } },
        },
      },
    });
  });

  it("merges project delegation-mode overrides per role and preserves unknown roles", () => {
    const withModes = environment("Server", {
      supportsAgentRoleDelegationModes: true,
      settings: {
        agentRoleDelegationModes: { review: "always", futureRole: "always" },
        projectSettingsOverrides: {
          [projectId]: {
            agentRoleDelegationModes: { implementation: "always", futureRole: "prefer" },
          },
        },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withModes], {
        agentRoleDelegationModes: { review: "always" },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          agentRoleDelegationModes: {
            implementation: "always",
            futureRole: "prefer",
            review: "always",
          },
        },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withModes], {
        agentRoleDelegationModes: { implementation: null },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: { agentRoleDelegationModes: { futureRole: "prefer" } },
      },
    });

    const onlyRole = environment("Server", {
      supportsAgentRoleDelegationModes: true,
      settings: {
        projectSettingsOverrides: {
          [projectId]: { agentRoleDelegationModes: { implementation: "always" } },
        },
      },
    });
    expect(
      planScopedSettingsPatch(project, [onlyRole], {
        agentRoleDelegationModes: { implementation: null },
      }).serverWrites[0]?.patch,
    ).toEqual({ projectSettingsOverrides: { [projectId]: {} } });
  });

  it("sends delegation modes only to environments that advertise support", () => {
    const modern = environment("Modern", { supportsAgentRoleDelegationModes: true });
    const legacy = environment("Legacy");
    const patch = { agentRoleDelegationModes: { review: "always" as const } };

    const envPlan = planScopedSettingsPatch(
      resolveSettingsScope({}, [], [modern, legacy]),
      [modern, legacy],
      patch,
    );
    expect(envPlan.serverWrites.map(({ environmentId }) => environmentId)).toEqual([
      modern.environmentId,
    ]);
    expect(envPlan.serverWrites[0]?.patch).toEqual(patch);
    expect(
      planScopedSettingsPatch(resolveSettingsScope({}, [], [legacy]), [legacy], patch),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
    });

    const projectPlan = planScopedSettingsPatch(
      project,
      [environment("Server", { supportsAgentRoleDelegationModes: true }), environment("Laptop")],
      patch,
    );
    expect(projectPlan.serverWrites).toEqual([
      {
        environmentId: server.environmentId,
        label: server.label,
        previous: expect.anything(),
        patch: {
          projectSettingsOverrides: {
            [projectId]: { agentRoleDelegationModes: { review: "always" } },
          },
        },
      },
    ]);
  });

  it("sends the security role only to environments that advertise it", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const security = { instanceId: claude, model: "security-model" };
    const review = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };
    const modern = environment("Modern", {
      agentRoleInstructionDefaults: agentRoleDefaults("Security text."),
    });
    const legacy = environment("Legacy", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
    });
    const scope = resolveSettingsScope({}, [], [modern, legacy]);

    const plan = planScopedSettingsPatch(scope, [modern, legacy], {
      agentRoleModels: { security, review },
      agentRoleInstructions: { security: "Audit hard." },
    });
    expect(plan.unavailableReason).toBeNull();
    expect(plan.serverWrites.map(({ environmentId }) => environmentId)).toEqual([
      modern.environmentId,
      legacy.environmentId,
    ]);
    expect(plan.serverWrites[0]?.patch).toEqual({
      agentRoleModels: { security, review },
      agentRoleInstructions: { security: "Audit hard." },
    });
    expect(plan.serverWrites[1]?.patch).toEqual({ agentRoleModels: { review } });

    const legacyOnly = planScopedSettingsPatch(resolveSettingsScope({}, [], [legacy]), [legacy], {
      agentRoleModels: { security },
    });
    expect(legacyOnly.serverWrites).toEqual([]);
    expect(legacyOnly.unavailableReason).toBe(
      "Security roles need a server that advertises them. Update T3 Code on it.",
    );
  });

  it("keeps a project security override off a destination that cannot store it", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const security = { instanceId: claude, model: "security-model" };
    const modernLaptop = environment("Laptop", {
      agentRoleInstructionDefaults: agentRoleDefaults("Security text."),
    });
    const legacyServer = environment("Server", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
    });
    const plan = planScopedSettingsPatch(project, [modernLaptop, legacyServer], {
      agentRoleModels: { security },
    });
    expect(plan.serverWrites).toHaveLength(1);
    expect(plan.serverWrites[0]?.environmentId).toBe(laptop.environmentId);
    expect(plan.serverWrites[0]?.patch).toEqual({
      projectSettingsOverrides: {
        [laptopProjectId]: { agentRoleModels: { security } },
      },
    });
  });

  it("preserves a saved project security role when editing an unrelated project setting", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const savedSecurity = { instanceId: claude, model: "saved-security-model" };
    const legacy = environment("Server", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            agentRoleModels: { security: savedSecurity },
            agentRoleInstructions: { security: "Saved security instructions." },
          },
        },
      },
    });
    const plan = planScopedSettingsPatch(project, [legacy], {
      agentRoleInstructions: { review: "New review instructions" },
    });
    expect(plan.serverWrites).toHaveLength(1);
    const persisted = applyServerSettingsPatch(
      legacy.serverConfig!.settings,
      plan.serverWrites[0]!.patch,
    );
    expect(persisted.projectSettingsOverrides[projectId]).toEqual({
      agentRoleModels: { security: savedSecurity },
      agentRoleInstructions: {
        security: "Saved security instructions.",
        review: "New review instructions",
      },
    });
  });

  it("preserves a saved project security role when clearing another override", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const savedSecurity = { instanceId: claude, model: "saved-security-model" };
    const legacy = environment("Server", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            defaultAutoPull: true,
            agentRoleModels: { security: savedSecurity },
            agentRoleInstructions: { security: "Saved security instructions." },
          },
        },
      },
    });
    const plan = planScopedSettingsClear(checkout, [legacy], ["defaultAutoPull"]);
    expect(plan.serverWrites).toHaveLength(1);
    const persisted = applyServerSettingsPatch(
      legacy.serverConfig!.settings,
      plan.serverWrites[0]!.patch,
    );
    expect(persisted.projectSettingsOverrides[projectId]).toEqual({
      agentRoleModels: { security: savedSecurity },
      agentRoleInstructions: { security: "Saved security instructions." },
    });
  });

  it("sends no write for an unsupported security-only project patch over a populated entry", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const legacy = environment("Server", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            defaultAutoPull: true,
            agentRoleInstructions: { review: "Existing review instructions." },
          },
        },
      },
    });
    const plan = planScopedSettingsPatch(project, [legacy], {
      agentRoleModels: { security: { instanceId: claude, model: "new-security-model" } },
    });
    expect(plan.serverWrites).toEqual([]);
    expect(plan.unavailableReason).toBe(
      "Security roles need a server that advertises them. Update T3 Code on it.",
    );
  });

  it("applies the supported part of a mixed patch without deleting a saved security role", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const codex = ProviderInstanceId.make("codex");
    const savedSecurity = { instanceId: claude, model: "saved-security-model" };
    const review = { instanceId: codex, model: "gpt-6-sol" };
    const legacy = environment("Server", {
      agentRoleInstructionDefaults: agentRoleDefaults(),
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            agentRoleModels: { security: savedSecurity },
            agentRoleInstructions: { security: "Saved security instructions." },
          },
        },
      },
    });
    const plan = planScopedSettingsPatch(project, [legacy], {
      agentRoleModels: {
        security: { instanceId: claude, model: "new-security-model" },
        review,
      },
    });
    expect(plan.serverWrites).toHaveLength(1);
    const persisted = applyServerSettingsPatch(
      legacy.serverConfig!.settings,
      plan.serverWrites[0]!.patch,
    );
    expect(persisted.projectSettingsOverrides[projectId]).toEqual({
      agentRoleModels: { security: savedSecurity, review },
      agentRoleInstructions: { security: "Saved security instructions." },
    });
  });

  it("merges project instruction overrides per role and keeps models separate", () => {
    const claude = ProviderInstanceId.make("claudeAgent");
    const architecture = { instanceId: claude, model: "opus-5" };
    const withRoles = environment("Server", {
      settings: {
        agentRoleModels: { architecture },
        agentRoleInstructions: { architecture: "Environment architecture." },
        projectSettingsOverrides: {
          [projectId]: {
            agentRoleModels: { architecture },
            agentRoleInstructions: { review: "Project review." },
          },
        },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withRoles], {
        agentRoleInstructions: { architecture: "New architecture text.\n" },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          agentRoleModels: { architecture },
          agentRoleInstructions: {
            review: "Project review.",
            architecture: "New architecture text.\n",
          },
        },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withRoles], {
        agentRoleInstructions: { review: null },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: { agentRoleModels: { architecture } },
      },
    });
    expect(
      planScopedSettingsPatch(project, [withRoles], {
        agentRoleInstructions: { review: "" },
      }).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          agentRoleModels: { architecture },
          agentRoleInstructions: { review: "" },
        },
      },
    });
  });

  it("keeps each project's other cleanup rules when changing one rule across machines", () => {
    const machine = environment("Laptop", {
      settings: {
        storageCleanup: { ...DEFAULT_SERVER_SETTINGS.storageCleanup, worktreeAfterDays: 30 },
      },
    });
    const customized = environment("Server", {
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            defaultAutoPull: true,
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: 8,
                worktreeSettledAfterDays: null,
                worktreeOnDelete: false,
                worktreeOnMerge: true,
                worktreeUnchanged: false,
                worktreeKeepWhen: "uncommitted-changes",
              },
            },
          },
        },
      },
    });
    const plan = planScopedSettingsPatch(project, [machine, customized], {
      worktreeCleanup: { mode: "custom", rules: { worktreeOnDelete: true } },
    });
    const settledPlan = planScopedSettingsPatch(project, [machine, customized], {
      worktreeCleanup: { mode: "custom", rules: { worktreeSettledAfterDays: 0 } },
    });
    expect(
      settledPlan.serverWrites.map((write) => write.patch.projectSettingsOverrides),
    ).toMatchObject([
      { [projectId]: { worktreeCleanup: { rules: { worktreeSettledAfterDays: 0 } } } },
      { [laptopProjectId]: { worktreeCleanup: { rules: { worktreeSettledAfterDays: 0 } } } },
    ]);
    expect(plan.serverWrites.map((write) => write.patch.projectSettingsOverrides)).toEqual([
      {
        [projectId]: {
          defaultAutoPull: true,
          worktreeCleanup: {
            mode: "custom",
            rules: {
              worktreeAfterDays: 8,
              worktreeSettledAfterDays: null,
              worktreeOnDelete: true,
              worktreeOnMerge: true,
              worktreeUnchanged: false,
              worktreeKeepWhen: "uncommitted-changes",
            },
          },
        },
      },
      {
        [laptopProjectId]: {
          worktreeCleanup: {
            mode: "custom",
            rules: {
              worktreeAfterDays: 30,
              worktreeSettledAfterDays: null,
              worktreeOnDelete: true,
              worktreeOnMerge: false,
              worktreeUnchanged: false,
              worktreeKeepWhen: "uncommitted-changes",
            },
          },
        },
      },
    ]);
    expect(
      planScopedSettingsClear(checkout, [customized], ["worktreeCleanup"]).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
    });
    expect(
      planScopedSettingsPatch(project, [machine, customized], {
        storageCleanup: { browserArtifactsAfterDays: 8 },
      }).serverWrites,
    ).toEqual([]);
  });

  // regression: #11541 device settings were written to the wrong scope
  it("scopes agent device access to projects while keeping hub and hosts environment-wide", () => {
    const plan = planScopedSettingsPatch(project, [laptop, server], {
      enableAgentDeviceAccess: true,
    });
    expect(plan.serverWrites.map((write) => write.patch)).toEqual([
      { projectSettingsOverrides: { [projectId]: { enableAgentDeviceAccess: true } } },
      { projectSettingsOverrides: { [laptopProjectId]: { enableAgentDeviceAccess: true } } },
    ]);
    for (const patch of [{ enableDeviceSupport: true }, { deviceHosts: [] }]) {
      expect(planScopedSettingsPatch(project, environments, patch).serverWrites).toEqual([]);
    }
  });

  it("refuses environment-wide keys at project scope", () => {
    expect(
      planScopedSettingsPatch(project, environments, { enableProviderUpdateChecks: false }),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: "This setting is environment-wide and cannot be overridden by a project.",
    });
  });

  // regression: #35093 client settings saved in project scope overwrote the global default
  it("refuses client-only keys at project scope", () => {
    for (const scope of [project, checkout]) {
      expect(
        planScopedSettingsPatch(scope, environments, {
          browserDefaultViewport: { _tag: "freeform", width: 1440, height: 900 },
        }),
      ).toMatchObject({
        clientPatch: {},
        hasClientWrite: false,
        serverWrites: [],
        unavailableReason:
          "This setting is environment-wide and cannot be overridden by a project.",
      });
      expect(
        planScopedSettingsPatch(
          scope,
          environments,
          { fontSizeInterface: 15 },
          { deviceOnly: true },
        ),
      ).toMatchObject({ clientPatch: { fontSizeInterface: 15 }, unavailableReason: null });
    }
  });

  it("clears overrides per member and removes an emptied entry", () => {
    const withOverrides = environment("Server", {
      settings: {
        projectSettingsOverrides: {
          [projectId]: { defaultAutoPull: true, enableAgentBrowserAccess: false },
        },
      },
    });
    const plan = planScopedSettingsClear(checkout, [laptop, withOverrides], ["defaultAutoPull"]);
    expect(plan.serverWrites).toEqual([
      {
        environmentId: server.environmentId,
        label: server.label,
        previous: expect.anything(),
        patch: { projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } } },
      },
    ]);
    expect(
      planScopedSettingsClear(
        checkout,
        [laptop, withOverrides],
        ["defaultAutoPull", "enableAgentBrowserAccess"],
      ).serverWrites[0]?.patch,
    ).toEqual({ projectSettingsOverrides: { [projectId]: null } });
  });

  it("never substitutes an environment-default write for an invalid scope", () => {
    const scope = resolveSettingsScope({ machine: "removed" }, [group], environments);
    const plan = planScopedSettingsPatch(scope, environments, { enableAgentBrowserAccess: false });
    expect(plan.serverWrites).toEqual([]);
    expect(plan.hasClientWrite).toBe(false);
    expect(plan.unavailableReason).not.toBeNull();
  });

  it("waits for every target and identifies both RPC failures and rejected writes", async () => {
    const third = environment("Third");
    const fourth = environment("Fourth");
    const selected = [...environments, third, fourth];
    const scope = resolveSettingsScope({}, [], selected);
    const persistServer = vi
      .fn()
      .mockResolvedValueOnce({ _tag: "Success" })
      .mockResolvedValueOnce({
        _tag: "Failure",
        cause: Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: "settings:write",
            message: "This connection lacks permission to change settings.",
          }),
        ),
      })
      .mockRejectedValueOnce(new Error("Disconnected during save"))
      .mockResolvedValueOnce({ _tag: "Success" });
    const result = await persistScopedSettingsPatch(
      planScopedSettingsPatch(scope, selected, { enableAgentBrowserAccess: false }),
      persistServer,
      vi.fn(),
    );
    expect(result.savedEnvironmentCount).toBe(2);
    expect(result.savedEnvironments.map(({ label }) => label)).toEqual([
      laptop.label,
      fourth.label,
    ]);
    expect(result.failedEnvironments.map(({ message }) => message)).toEqual([
      "This connection lacks permission to change settings.",
      "Disconnected during save",
    ]);
    expect(result.failedEnvironments.map(({ label }) => label)).toEqual([
      server.label,
      third.label,
    ]);
    expect(persistServer).toHaveBeenCalledTimes(4);
  });

  describe("rapid project saves on one environment", () => {
    const saving = (initial: ServerSettings) => {
      let stored = initial;
      const persistServer = vi.fn(async ({ input }: { input: { patch: ServerSettingsPatch } }) => {
        stored = applyServerSettingsPatch(stored, input.patch);
        return { _tag: "Success" as const, value: stored };
      });
      return { persistServer, stored: () => stored };
    };

    // regression: #18426 rapid project saves rebuilt overrides from a copy that trailed them
    it("keeps every edit and reset while the client's copy trails its saves", async () => {
      let copy: ServerSettings = {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } },
      };
      const host = saving(copy);
      // No config push arrives, so the client's copy stays as it was before the first save.
      const write = createScopedSettingsWriter(() => copy);
      const save = (plan: Parameters<typeof write>[1]) =>
        write([environment("Server", { settings: copy })], plan, host.persistServer, vi.fn());
      await Promise.all([
        save((current) => planScopedSettingsPatch(checkout, current, { defaultAutoPull: true })),
        save((current) => planScopedSettingsClear(checkout, current, ["enableAgentBrowserAccess"])),
        save((current) =>
          planScopedSettingsPatch(checkout, current, { removeAgentCreditsOnMerge: true }),
        ),
      ]);
      expect(host.stored().projectSettingsOverrides[projectId]).toEqual({
        defaultAutoPull: true,
        removeAgentCreditsOnMerge: true,
      });
      // The first save's push arrives late, after the newer saves have finished.
      copy = (await host.persistServer.mock.results[0]!.value).value;
      await save((current) =>
        planScopedSettingsPatch(checkout, current, { defaultThreadEnvMode: "worktree" }),
      );
      expect(host.stored().projectSettingsOverrides[projectId]).toEqual({
        defaultAutoPull: true,
        removeAgentCreditsOnMerge: true,
        defaultThreadEnvMode: "worktree",
      });
    });

    it.each(["remote", "previous save"] as const)(
      "keeps the current base when a %s push arrives during a save",
      async (push) => {
        let copy: ServerSettings = DEFAULT_SERVER_SETTINGS;
        const host = saving(copy);
        const write = createScopedSettingsWriter(() => copy);
        const edit = (patch: ServerSettingsPatch) =>
          write(
            [environment("Server", { settings: copy })],
            (current) => planScopedSettingsPatch(checkout, current, patch),
            host.persistServer,
            vi.fn(),
          );
        await edit({ defaultAutoPull: true });
        const previous = host.stored();
        const persist = host.persistServer.getMockImplementation()!;
        host.persistServer.mockImplementationOnce(async (request) => {
          const response = await persist(request);
          if (push === "remote") {
            await persist({
              input: {
                patch: {
                  projectSettingsOverrides: {
                    [projectId]: { enableAgentBrowserAccess: false },
                  },
                },
              },
            });
            copy = host.stored();
          } else {
            copy = { ...previous };
          }
          return response;
        });
        await edit({ removeAgentCreditsOnMerge: true });
        await edit({ defaultThreadEnvMode: "worktree" });
        expect(host.stored().projectSettingsOverrides[projectId]).toEqual(
          push === "remote"
            ? { enableAgentBrowserAccess: false, defaultThreadEnvMode: "worktree" }
            : {
                defaultAutoPull: true,
                removeAgentCreditsOnMerge: true,
                defaultThreadEnvMode: "worktree",
              },
        );
      },
    );

    it("plans from a copy that changed after the last save, and saves again after a failure", async () => {
      let copy: ServerSettings = DEFAULT_SERVER_SETTINGS;
      const host = saving(copy);
      const write = createScopedSettingsWriter(() => copy);
      const edit = (patch: ServerSettingsPatch) =>
        write(
          [environment("Server", { settings: copy })],
          (current) => planScopedSettingsPatch(checkout, current, patch),
          host.persistServer,
          vi.fn(),
        );
      host.persistServer.mockRejectedValueOnce(new Error("Disconnected"));
      expect((await edit({ defaultAutoPull: true })).failedEnvironments).toMatchObject([
        { message: "Disconnected" },
      ]);
      expect((await edit({ defaultAutoPull: true })).savedEnvironmentCount).toBe(1);
      // Another client replaces the override, and its push reaches this client.
      await host.persistServer({
        input: {
          patch: { projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } } },
        },
      });
      copy = host.stored();
      await edit({ removeAgentCreditsOnMerge: true });
      expect(host.stored().projectSettingsOverrides[projectId]).toEqual({
        enableAgentBrowserAccess: false,
        removeAgentCreditsOnMerge: true,
      });
    });
  });
});

describe("scoped settings mixed values", () => {
  it("treats independently decoded equal nested settings as the same value", () => {
    const style = {
      ...DEFAULT_SERVER_SETTINGS.sourceControlWritingStyle,
      mode: "custom" as const,
      customInstructions: "Use plain language",
    };
    const first = environment("First", { settings: { sourceControlWritingStyle: { ...style } } });
    const second = environment("Second", { settings: { sourceControlWritingStyle: { ...style } } });
    const targets = resolveScopedSettingsTargets(all, [first, second]);
    expect(scopedSettingsAreMixed(targets, ["sourceControlWritingStyle"])).toBe(false);
  });

  it("agrees while a save is in flight and follows the environment once it reports back", () => {
    const patch = { defaultRuntimeMode: "auto" as const };
    const saved = environment("Laptop", { settings: patch });
    let waiting = environment("Server");
    const save = {};
    let writes: readonly PendingScopedWrite[] = [saved, waiting].map(({ environmentId }) => ({
      save,
      environmentId,
      patch,
    }));
    const mixed = () =>
      scopedSettingsAreMixed(
        resolveScopedSettingsTargets(all, applyPendingScopedWrites([saved, waiting], writes)),
        ["defaultRuntimeMode"],
      );
    const settle = (environmentId: EnvironmentId, result?: ServerSettings) => {
      writes = settlePendingScopedWrites(
        writes,
        { save, environmentId },
        (id) => [saved, waiting].find((env) => env.environmentId === id)?.serverConfig?.settings,
        result,
      );
    };
    expect(mixed()).toBe(false);

    // Laptop already pushed its result; Server answers before its push arrives.
    settle(saved.environmentId, saved.serverConfig!.settings);
    settle(waiting.environmentId, applyServerSettingsPatch(waiting.serverConfig!.settings, patch));
    expect(writes.map(({ environmentId }) => environmentId)).toEqual([waiting.environmentId]);
    expect(mixed()).toBe(false);

    waiting = environment("Server", { settings: { defaultRuntimeMode: "approval-required" } });
    expect(mixed()).toBe(true);

    writes = [{ save, environmentId: waiting.environmentId, patch }];
    settle(waiting.environmentId);
    expect(writes).toEqual([]);
  });
});

describe("project overrides at environment scope", () => {
  const laptop = EnvironmentId.make("laptop");
  const fleet = ProjectId.make("fleet");
  const t3 = ProjectId.make("t3");
  const environment = (
    environmentId: EnvironmentId,
    overrides: ServerSettings["projectSettingsOverrides"],
  ) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" as const },
    serverConfig: {
      settings: { ...DEFAULT_SERVER_SETTINGS, projectSettingsOverrides: overrides },
      environment: { capabilities: { projectSettingsOverrides: true } },
    },
  });

  it("clears only those keys and drops entries that become empty", () => {
    const plan = planProjectOverridesClear(
      [
        environment(laptop, {
          [fleet]: { defaultAutoPull: true, defaultThreadEnvMode: "local" },
          [t3]: { defaultAutoPull: true },
        }),
      ],
      [
        { environmentId: laptop, projectId: fleet },
        { environmentId: laptop, projectId: t3 },
      ],
      ["defaultAutoPull"],
    );
    expect(plan.serverWrites).toEqual([
      {
        environmentId: laptop,
        label: laptop,
        previous: expect.anything(),
        patch: {
          projectSettingsOverrides: { [fleet]: { defaultThreadEnvMode: "local" }, [t3]: null },
        },
      },
    ]);
  });
});

describe("null patches at project scope", () => {
  it("removes the override for keys that cannot store null and keeps it for keys that can", () => {
    const environmentId = EnvironmentId.make("laptop");
    const projectId = ProjectId.make("fleet");
    const scope = {
      kind: "project" as const,
      group: {} as never,
      environmentId: null,
      label: "fleet",
      members: [{ id: projectId, environmentId } as never],
      environmentIds: [environmentId],
    };
    const environments = [
      {
        environmentId,
        label: "Laptop",
        connection: { phase: "connected" as const },
        serverConfig: {
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            projectSettingsOverrides: {
              [projectId]: { defaultThreadEnvMode: "worktree" as const, defaultAutoPull: true },
            },
          },
          environment: { capabilities: { projectSettingsOverrides: true } },
        },
      },
    ];
    expect(
      planScopedSettingsPatch(scope, environments, { defaultThreadEnvMode: null }).serverWrites[0]
        ?.patch,
    ).toEqual({ projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } } });
    expect(
      planScopedSettingsPatch(scope, environments, { defaultModelSelection: null }).serverWrites[0]
        ?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          defaultThreadEnvMode: "worktree",
          defaultAutoPull: true,
          defaultModelSelection: null,
        },
      },
    });
  });
});

describe("partial object patches at project scope", () => {
  it("completes a writing style field patch from the target's effective value", () => {
    const environmentId = EnvironmentId.make("laptop");
    const projectId = ProjectId.make("fleet");
    const member = {
      id: projectId,
      environmentId,
      physicalProjectKey: "laptop:/repo",
      environmentLabel: "Laptop",
      title: "fleet",
      workspaceRoot: "/repo",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          sourceControlWritingStyle: {
            mode: "custom" as const,
            customInstructions: "Keep it short.",
            followChangeRequestTemplates: false,
          },
        },
      },
    };
    const plan = planScopedSettingsPatch(
      {
        kind: "project",
        group: {} as never,
        environmentId: null,
        label: "fleet",
        members: [member as never],
        environmentIds: [environmentId],
      },
      [
        {
          environmentId,
          label: "Laptop",
          connection: { phase: "connected" },
          serverConfig: {
            settings,
          },
        },
      ],
      { sourceControlWritingStyle: { customInstructions: "Be terse." } },
    );
    expect(plan.serverWrites[0]?.patch).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          sourceControlWritingStyle: {
            mode: "custom",
            customInstructions: "Be terse.",
            followChangeRequestTemplates: false,
          },
        },
      },
    });
  });
});

it("routes legacy model preference keys exclusively to the selected environment", () => {
  const patch = {
    favorites: [{ provider: ProviderInstanceId.make("codex"), model: "sol" }],
    providerModelPreferences: {},
  };
  const plan = planScopedSettingsPatch(named, environments, patch);
  expect(plan.clientPatch).toEqual({});
  expect(plan.hasClientWrite).toBe(false);
  expect(plan.serverWrites).toEqual([
    {
      environmentId: server.environmentId,
      label: server.label,
      previous: expect.anything(),
      patch,
    },
  ]);
});

describe("model selection patches at project scope", () => {
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");
  const saved = {
    instanceId: codex,
    model: "gpt-5.6",
    options: [{ id: "reasoningEffort", value: "high" }],
  };
  const customized = environment("Server", {
    settings: {
      projectSettingsOverrides: {
        [projectId]: {
          defaultModelSelection: saved,
          sourceControlWriterModelSelection: saved,
          reviewGuideModelSelection: saved,
          textGenerationModelSelection: saved,
        },
      },
    },
  });

  // regression: #16581 changing a project's model kept the old model's options
  it("replaces old options when changing model selections", () => {
    const plan = planScopedSettingsPatch(checkout, [customized], {
      defaultModelSelection: { instanceId: claude, model: "claude-opus-4-8" },
      sourceControlWriterModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      reviewGuideModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      textGenerationModelSelection: { instanceId: claude, model: "claude-sonnet-4-6" },
    });
    expect(plan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]).toEqual({
      defaultModelSelection: { instanceId: claude, model: "claude-opus-4-8" },
      sourceControlWriterModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      reviewGuideModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      textGenerationModelSelection: { instanceId: claude, model: "claude-sonnet-4-6" },
    });
  });

  it("completes partial text-generation selections without retaining old options", () => {
    const modelPlan = planScopedSettingsPatch(checkout, [customized], {
      textGenerationModelSelection: { model: "gpt-5.6-mini" },
    });
    expect(
      modelPlan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]
        ?.textGenerationModelSelection,
    ).toEqual({ instanceId: codex, model: "gpt-5.6-mini" });

    const options = [{ id: "reasoningEffort", value: "low" }];
    const optionsPlan = planScopedSettingsPatch(checkout, [customized], {
      textGenerationModelSelection: { options },
    });
    expect(
      optionsPlan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]
        ?.textGenerationModelSelection,
    ).toEqual({ ...saved, options });
  });
});
