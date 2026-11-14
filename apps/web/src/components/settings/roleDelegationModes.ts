import {
  DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  type AgentRoleDelegationMode,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";

export const AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE =
  "Delegation modes need a server that supports them. Update T3 Code on it.";

export const AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE =
  "Connect an environment to set how this role delegates.";

export const ROLE_DELEGATION_MODE_LABELS: Readonly<Record<AgentRoleDelegationMode, string>> = {
  prefer: "Prefer",
  always: "Always",
};

export interface RoleDelegationModeTarget {
  /** Display label for this target's environment. */
  readonly environmentLabel: string;
  /** Mode saved for this project, when the scope has one. */
  readonly projectMode?: AgentRoleDelegationMode | undefined;
  /** Mode saved on the environment for this role. */
  readonly environmentMode?: AgentRoleDelegationMode | undefined;
  /** Only a role with an effective model is active, so the control waits for one. */
  readonly hasModel: boolean;
}

export interface RoleDelegationModeState {
  readonly mixed: boolean;
  /** Null when mixed, so neither option reads as chosen. */
  readonly value: AgentRoleDelegationMode | null;
  readonly disabledReason: string | null;
  /** A saved mode can be cleared without an active model; only a server that drops the write blocks it. */
  readonly resetDisabled: boolean;
  readonly statusLine: string;
  readonly showReset: boolean;
  readonly resetLabel: "Use inherited" | "Use default";
}

export function roleDelegationModeState(input: {
  readonly projectScope: boolean;
  /** False when any selected server cannot store modes; the write would be dropped silently. */
  readonly modesSupported: boolean;
  readonly targets: ReadonlyArray<RoleDelegationModeTarget>;
}): RoleDelegationModeState {
  const { projectScope, targets } = input;
  const resetLabel = projectScope ? "Use inherited" : "Use default";
  const first = targets[0];
  if (first === undefined) {
    return {
      mixed: false,
      value: DEFAULT_AGENT_ROLE_DELEGATION_MODE,
      disabledReason: AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE,
      resetDisabled: true,
      statusLine: `Defaults to ${DEFAULT_AGENT_ROLE_DELEGATION_MODE}.`,
      showReset: false,
      resetLabel,
    };
  }
  const modes = targets.map(
    (target) => target.projectMode ?? target.environmentMode ?? DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  );
  const mixed = modes.length > 1 && modes.some((mode) => !Equal.equals(mode, modes[0]!));
  const explicit = targets.map((target) =>
    projectScope ? target.projectMode : target.environmentMode,
  );
  const explicitCount = explicit.filter((mode) => mode !== undefined).length;
  const showReset = explicitCount > 0;
  const disabledReason = !input.modesSupported
    ? AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE
    : targets.some((target) => target.hasModel)
      ? null
      : "Choose a model for this role to set how it delegates.";
  const resetDisabled = !input.modesSupported;
  const statusLine = mixed
    ? "Mixed across selected environments. Choosing one sets it for all."
    : projectScope
      ? first.projectMode !== undefined
        ? "Set for this project."
        : first.environmentMode !== undefined
          ? `Inherited from ${first.environmentLabel}.`
          : `Defaults to ${DEFAULT_AGENT_ROLE_DELEGATION_MODE}.`
      : first.environmentMode !== undefined && explicitCount === targets.length
        ? targets.length > 1
          ? "Set on the selected environments."
          : `Set on ${first.environmentLabel}.`
        : explicitCount > 0 && targets.length > 1
          ? "Set on some selected environments."
          : `Defaults to ${DEFAULT_AGENT_ROLE_DELEGATION_MODE}.`;
  return {
    mixed,
    value: mixed ? null : modes[0]!,
    disabledReason,
    resetDisabled,
    statusLine,
    showReset,
    resetLabel,
  };
}
