import { msg } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";
import {
  DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  type AgentRoleDelegationMode,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";

export const AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE = msg(
  "Delegation modes need a server that supports them. Update T3 Code on it.",
);

export const AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE = msg(
  "Connect an environment to set how this role delegates.",
);

export const ROLE_DELEGATION_MODE_LABELS: Readonly<Record<AgentRoleDelegationMode, string>> = {
  prefer: msg("Prefer"),
  always: msg("Always"),
};

export interface RoleDelegationModeTarget {
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
  /** The only line the control shows: why it is inert, or that the selection disagrees. */
  readonly note: string | null;
  /** Neither mode is saved on this project, so the pressed mode is the environment's. */
  readonly inherited: boolean;
  readonly showReset: boolean;
  readonly resetTooltip: string;
}

export function roleDelegationModeState(
  input: {
    readonly projectScope: boolean;
    /** False when any selected server cannot store modes; the write would be dropped silently. */
    readonly modesSupported: boolean;
    readonly targets: ReadonlyArray<RoleDelegationModeTarget>;
  },
  resolve: MessageResolver = m,
): RoleDelegationModeState {
  const { projectScope, targets } = input;
  const first = targets[0];
  if (first === undefined) {
    return {
      mixed: false,
      value: DEFAULT_AGENT_ROLE_DELEGATION_MODE,
      disabledReason: resolve(AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE),
      resetDisabled: true,
      note: resolve(AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE),
      inherited: false,
      showReset: false,
      resetTooltip: resolve(msg("Reset to inherited value")),
    };
  }
  const modes = targets.map(
    (target) => target.projectMode ?? target.environmentMode ?? DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  );
  const mixed = modes.length > 1 && modes.some((mode) => !Equal.equals(mode, modes[0]!));
  const inheritedModes = targets.map(
    (target) => target.environmentMode ?? DEFAULT_AGENT_ROLE_DELEGATION_MODE,
  );
  const inheritedMode = inheritedModes[0]!;
  const resetTooltip =
    inheritedModes.length > 1 && inheritedModes.some((mode) => !Equal.equals(mode, inheritedMode))
      ? resolve(msg("Reset to inherited value"))
      : resolve(
          msg("Reset to inherited value ({value})", {
            value: resolve(ROLE_DELEGATION_MODE_LABELS[inheritedMode]),
          }),
        );
  const showReset = projectScope && targets.some((target) => target.projectMode !== undefined);
  const disabledReason = !input.modesSupported
    ? resolve(AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE)
    : targets.some((target) => target.hasModel)
      ? null
      : resolve(msg("Choose a model for this role to set how it delegates."));
  const resetDisabled = !input.modesSupported;
  const inherited =
    projectScope &&
    disabledReason === null &&
    targets.every((target) => target.projectMode === undefined);
  return {
    mixed,
    value: mixed ? null : modes[0]!,
    disabledReason,
    resetDisabled,
    note:
      disabledReason ??
      (mixed
        ? resolve(msg("Mixed across selected environments. Choosing one sets it for all."))
        : null),
    inherited,
    showReset,
    resetTooltip,
  };
}
