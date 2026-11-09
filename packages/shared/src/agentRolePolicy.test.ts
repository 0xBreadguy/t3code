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
const lead = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus-5" };
const review = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };

const settings = (overrides: Partial<ServerSettings> = {}): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  agentRoleModels: { lead },
  ...overrides,
});

describe("resolveAgentRoleModel", () => {
  it("prefers an explicit target over both policy scopes", () => {
    const resolved = resolveAgentRoleModel({
      settings: settings(),
      projectId,
      role: "lead",
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
    const environment = settings({ agentRoleModels: { lead, review } });
    expect(resolveAgentRoleModel({ settings: environment, projectId, role: "lead" })).toEqual({
      modelSelection: lead,
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
    ).toMatchObject({ lead, review });
  });
});

describe("resolveAgentRoleTarget", () => {
  const providers = [
    { instanceId: lead.instanceId, enabled: true, available: true, models: [{ slug: lead.model }] },
  ];
  const resolve = (input: {
    explicitTarget?: boolean;
    role?: "lead" | "review";
    settings?: ServerSettings;
  }) =>
    resolveAgentRoleTarget({
      settings: input.settings ?? settings(),
      projectId,
      role: input.role ?? "lead",
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
    expect(resolve({})).toEqual({ type: "use", modelSelection: lead });
  });

  it("reports a disabled provider or missing model instead of substituting", () => {
    expect(
      resolveAgentRoleTarget({
        settings: settings(),
        projectId,
        role: "lead",
        explicitTarget: false,
        providers: [{ ...providers[0]!, available: false }],
      }),
    ).toEqual({ type: "provider_disabled", instanceId: lead.instanceId });

    expect(
      resolveAgentRoleTarget({
        settings: settings({ agentRoleModels: { lead: { ...lead, model: "missing" } } }),
        projectId,
        role: "lead",
        explicitTarget: false,
        providers,
      }),
    ).toEqual({
      type: "model_unavailable",
      instanceId: lead.instanceId,
      model: "missing",
    });
  });
});
