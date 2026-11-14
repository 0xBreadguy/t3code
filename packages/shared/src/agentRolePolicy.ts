import {
  DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  type AgentRole,
  type AgentRoleDelegationMode,
  type AgentRoleDelegationModes,
  type AgentRoleModelPolicySource,
  type AgentRoleModelSelections,
  type ModelSelection,
  type ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";

/** Roles an ordinary parent may route to a managed child. */
const DELEGABLE_AGENT_ROLES = [
  "architecture",
  "implementation",
  "research",
  "review",
  "security",
  "design",
  "test",
  "general",
] as const;

export type DelegableAgentRole = (typeof DELEGABLE_AGENT_ROLES)[number];

export interface ResolvedAgentRoleModel {
  readonly modelSelection: ModelSelection;
  readonly source: AgentRoleModelPolicySource;
}

/**
 * Explicit target, then the project's role map, then the environment's role
 * map. No role configured returns null so the caller keeps its existing
 * inheritance. Availability is checked by the server, never guessed here.
 */
export function resolveAgentRoleModel(input: {
  readonly settings: Pick<ServerSettings, "agentRoleModels" | "projectSettingsOverrides">;
  readonly projectId: ProjectId;
  readonly role: AgentRole;
  readonly explicit?: ModelSelection | undefined;
}): ResolvedAgentRoleModel | null {
  if (input.explicit !== undefined) {
    return { modelSelection: input.explicit, source: "explicit" };
  }
  const projectRole =
    input.settings.projectSettingsOverrides[input.projectId]?.agentRoleModels?.[input.role];
  if (projectRole !== undefined) {
    return { modelSelection: projectRole, source: "project_role" };
  }
  const environmentRole = input.settings.agentRoleModels[input.role];
  if (environmentRole !== undefined) {
    return { modelSelection: environmentRole, source: "environment_role" };
  }
  return null;
}

export type AgentRoleTargetResolution =
  | { readonly type: "inherit" }
  | { readonly type: "use"; readonly modelSelection: ModelSelection }
  | {
      readonly type: "provider_disabled";
      readonly instanceId: ModelSelection["instanceId"];
    }
  | {
      readonly type: "model_unavailable";
      readonly instanceId: ModelSelection["instanceId"];
      readonly model: string;
    };

/**
 * Deterministic role routing for a T3-owned launch: an explicit target wins,
 * otherwise the role policy applies. A configured but disabled or missing
 * choice is reported, never replaced by the parent's model.
 */
export function resolveAgentRoleTarget(input: {
  readonly settings: Pick<ServerSettings, "agentRoleModels" | "projectSettingsOverrides">;
  readonly projectId: ProjectId;
  readonly role: AgentRole | undefined;
  readonly explicitTarget: boolean;
  readonly providers: ReadonlyArray<{
    readonly instanceId: ModelSelection["instanceId"];
    readonly enabled: boolean;
    readonly available: boolean;
    readonly models: ReadonlyArray<{ readonly slug: string }>;
  }>;
}): AgentRoleTargetResolution {
  if (input.role === undefined || input.explicitTarget) return { type: "inherit" };
  const policy = resolveAgentRoleModel({
    settings: input.settings,
    projectId: input.projectId,
    role: input.role,
  });
  if (policy === null) return { type: "inherit" };
  const selection = policy.modelSelection;
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  if (provider === undefined || !provider.enabled || !provider.available) {
    return { type: "provider_disabled", instanceId: selection.instanceId };
  }
  if (
    provider.models.length > 0 &&
    !provider.models.some((candidate) => candidate.slug === selection.model)
  ) {
    return {
      type: "model_unavailable",
      instanceId: selection.instanceId,
      model: selection.model,
    };
  }
  return { type: "use", modelSelection: selection };
}

/** Sparse project map over the environment map; useful for Settings and read results. */
export function effectiveAgentRoleModels(
  settings: Pick<ServerSettings, "agentRoleModels" | "projectSettingsOverrides">,
  projectId: ProjectId,
): AgentRoleModelSelections {
  return {
    ...settings.agentRoleModels,
    ...settings.projectSettingsOverrides[projectId]?.agentRoleModels,
  };
}

/**
 * Project key, then environment key, then `prefer`. An instruction or mode alone
 * never activates a role; only a configured model does.
 */
export function resolveAgentRoleDelegationMode(input: {
  readonly settings: Pick<ServerSettings, "agentRoleDelegationModes" | "projectSettingsOverrides">;
  readonly projectId: ProjectId;
  readonly role: AgentRole;
}): AgentRoleDelegationMode {
  const projectMode =
    input.settings.projectSettingsOverrides[input.projectId]?.agentRoleDelegationModes?.[
      input.role
    ];
  if (projectMode !== undefined) return projectMode;
  return input.settings.agentRoleDelegationModes[input.role] ?? DEFAULT_AGENT_ROLE_DELEGATION_MODE;
}

export function effectiveAgentRoleDelegationModes(
  settings: Pick<ServerSettings, "agentRoleDelegationModes" | "projectSettingsOverrides">,
  projectId: ProjectId,
): AgentRoleDelegationModes {
  return {
    ...settings.agentRoleDelegationModes,
    ...settings.projectSettingsOverrides[projectId]?.agentRoleDelegationModes,
  };
}

export interface ActiveAgentRole {
  readonly role: DelegableAgentRole;
  readonly modelSelection: ModelSelection;
  readonly source: AgentRoleModelPolicySource;
  readonly delegationMode: AgentRoleDelegationMode;
}

/**
 * Roles a top-level parent may route to, in catalog order. Only an effective
 * model makes a role active, so instruction-only and mode-only entries stay
 * invisible until the user chooses a model.
 */
export function activeAgentRoles(input: {
  readonly settings: Pick<
    ServerSettings,
    "agentRoleModels" | "agentRoleDelegationModes" | "projectSettingsOverrides"
  >;
  readonly projectId: ProjectId;
}): ReadonlyArray<ActiveAgentRole> {
  return DELEGABLE_AGENT_ROLES.flatMap((role) => {
    const model = resolveAgentRoleModel({
      settings: input.settings,
      projectId: input.projectId,
      role,
    });
    if (model === null) return [];
    return [
      {
        role,
        modelSelection: model.modelSelection,
        source: model.source,
        delegationMode: resolveAgentRoleDelegationMode({
          settings: input.settings,
          projectId: input.projectId,
          role,
        }),
      },
    ];
  });
}
