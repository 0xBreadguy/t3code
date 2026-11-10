import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  effectiveAgentRoleModels,
  resolveAgentRoleModel,
  resolveAgentRoleTarget,
} from "./agentRolePolicy.ts";

const projectId = ProjectId.make("project-a");
const architecture = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus-5" };
const review = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };

const settings = (overrides: Partial<ServerSettings> = {}): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  agentRoleModels: { architecture },
  ...overrides,
});

describe("resolveAgentRoleModel", () => {
  it("prefers an explicit target over both policy scopes", () => {
    const resolved = resolveAgentRoleModel({
      settings: settings(),
      projectId,
      role: "architecture",
      explicit: review,
    });
    expect(resolved).toEqual({ modelSelection: review, source: "explicit" });
  });

  it("prefers a project role and inherits remaining environment roles", () => {
    const resolved = resolveAgentRoleModel({
      settings: settings({
        projectSettingsOverrides: {
          [projectId]: { agentRoleModels: { review } },
        },
      }),
      projectId,
      role: "review",
    });
    expect(resolved).toEqual({ modelSelection: review, source: "project_role" });

    expect(resolveAgentRoleModel({ settings: settings(), projectId, role: "review" })).toBeNull();
  });

  it("falls back to the environment role, then the caller's inheritance", () => {
    const environment = settings({ agentRoleModels: { architecture, review } });
    expect(
      resolveAgentRoleModel({ settings: environment, projectId, role: "architecture" }),
    ).toEqual({
      modelSelection: architecture,
      source: "environment_role",
    });
    expect(
      resolveAgentRoleModel({ settings: environment, projectId, role: "research" }),
    ).toBeNull();
  });

  it("merges the sparse project map over the environment map for display", () => {
    expect(
      effectiveAgentRoleModels(
        settings({
          projectSettingsOverrides: { [projectId]: { agentRoleModels: { review } } },
        }),
        projectId,
      ),
    ).toMatchObject({ architecture, review });
  });

  it("resolves security independently of review at each scope", () => {
    const security = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "security-model",
    };
    const environment = settings({ agentRoleModels: { review, security } });
    expect(resolveAgentRoleModel({ settings: environment, projectId, role: "security" })).toEqual({
      modelSelection: security,
      source: "environment_role",
    });
    expect(
      resolveAgentRoleModel({
        settings: settings({
          agentRoleModels: { review, security },
          projectSettingsOverrides: {
            [projectId]: {
              agentRoleModels: { review, security: { ...security, model: "project-security" } },
            },
          },
        }),
        projectId,
        role: "security",
      }),
    ).toEqual({
      modelSelection: { ...security, model: "project-security" },
      source: "project_role",
    });
    expect(
      resolveAgentRoleModel({
        settings: settings({
          agentRoleModels: { review, security },
          projectSettingsOverrides: {
            [projectId]: { agentRoleModels: { review } },
          },
        }),
        projectId,
        role: "security",
      }),
    ).toEqual({ modelSelection: security, source: "environment_role" });
  });
});

describe("resolveAgentRoleTarget", () => {
  const providers = [
    {
      instanceId: architecture.instanceId,
      enabled: true,
      available: true,
      models: [{ slug: architecture.model }],
    },
  ];
  const resolve = (input: {
    explicitTarget?: boolean;
    role?: "architecture" | "review";
    settings?: ServerSettings;
  }) =>
    resolveAgentRoleTarget({
      settings: input.settings ?? settings(),
      projectId,
      role: input.role ?? "architecture",
      explicitTarget: input.explicitTarget ?? false,
      providers,
    });

  it("lets an explicit task target win and inherits when no role is configured", () => {
    expect(resolve({ explicitTarget: true })).toEqual({ type: "inherit" });
    expect(resolve({ settings: DEFAULT_SERVER_SETTINGS, role: "review" })).toEqual({
      type: "inherit",
    });
  });

  it("uses the configured role model", () => {
    expect(resolve({})).toEqual({ type: "use", modelSelection: architecture });
  });

  it("reports a disabled provider or missing model instead of substituting", () => {
    expect(
      resolveAgentRoleTarget({
        settings: settings(),
        projectId,
        role: "architecture",
        explicitTarget: false,
        providers: [{ ...providers[0]!, available: false }],
      }),
    ).toEqual({ type: "provider_disabled", instanceId: architecture.instanceId });

    expect(
      resolveAgentRoleTarget({
        settings: settings({
          agentRoleModels: { architecture: { ...architecture, model: "missing" } },
        }),
        projectId,
        role: "architecture",
        explicitTarget: false,
        providers,
      }),
    ).toEqual({
      type: "model_unavailable",
      instanceId: architecture.instanceId,
      model: "missing",
    });
  });
});
