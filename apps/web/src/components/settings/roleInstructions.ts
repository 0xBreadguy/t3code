import * as Equal from "effect/Equal";

export interface RoleInstructionTarget {
  /** Stable identity; labels are display text and can collide or change. */
  readonly environmentId: string;
  readonly projectId: string | null;
  readonly builtIn: string;
  readonly projectText: string | undefined;
  readonly environmentText: string | undefined;
}

export type RoleInstructionSummary = "built-in" | "custom" | "none" | "mixed" | "unsaved";

export interface RoleInstructionState {
  readonly mixed: boolean;
  /** The resolved text for the current scope; mixed starts empty. */
  readonly resolvedText: string;
  readonly summary: RoleInstructionSummary;
  readonly statusLine: string;
  /** Nothing is saved on this project, so the editor reads as the environment's text. */
  readonly inherited: boolean;
  readonly showReset: boolean;
  readonly resetTooltip: string;
  /** Present only when one patch restores every target's exact prior override. */
  readonly undoText: string | undefined;
  readonly canStartFromBuiltIn: boolean;
  readonly builtInText: string | null;
}

function explicitText(target: RoleInstructionTarget, projectScope: boolean): string | undefined {
  return projectScope ? target.projectText : target.environmentText;
}

function inheritedText(target: RoleInstructionTarget): string {
  return target.environmentText ?? target.builtIn;
}

function effectiveText(target: RoleInstructionTarget, projectScope: boolean): string {
  return explicitText(target, projectScope) ?? inheritedText(target);
}

/** What the environment gives a project: its own text, or the built-in when it has none. */
function inheritedSummary(target: RoleInstructionTarget): RoleInstructionSummary {
  const text = inheritedText(target);
  if (text === target.builtIn) return "built-in";
  return text === "" ? "none" : "custom";
}

function roleInstructionSummary(input: {
  readonly projectScope: boolean;
  readonly mixed: boolean;
  readonly dirty: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
}): { readonly summary: RoleInstructionSummary; readonly statusLine: string } {
  if (input.dirty) {
    return { summary: "unsaved", statusLine: "Unsaved changes" };
  }
  if (input.mixed) {
    return {
      summary: "mixed",
      statusLine: "Different on the selected environments. Saving writes this text to each one.",
    };
  }
  const target = input.targets[0];
  if (target === undefined) {
    return { summary: "built-in", statusLine: "" };
  }
  const own = explicitText(target, input.projectScope);
  return {
    summary: own === undefined ? inheritedSummary(target) : own === "" ? "none" : "custom",
    statusLine: "",
  };
}

/** What a project reset falls back to; null when the targets disagree. */
function inheritedSummaryLabel(targets: ReadonlyArray<RoleInstructionTarget>): string | null {
  const labels = targets.map((target) => roleInstructionSummaryLabel(inheritedSummary(target)));
  const first = labels[0];
  return first === undefined || labels.some((label) => label !== first) ? null : first;
}

function resetTooltip(
  projectScope: boolean,
  targets: ReadonlyArray<RoleInstructionTarget>,
): string {
  if (!projectScope) return "Reset to built-in";
  const inherited = inheritedSummaryLabel(targets);
  return inherited === null
    ? "Reset to inherited value"
    : `Reset to inherited value (${inherited})`;
}

export function roleInstructionState(input: {
  readonly projectScope: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
  readonly draft: string;
  readonly edited: boolean;
}): RoleInstructionState {
  const { targets, projectScope } = input;
  const mixed =
    targets.length > 1 &&
    targets.some(
      (target) =>
        !Equal.equals(
          effectiveText(target, projectScope),
          effectiveText(targets[0]!, projectScope),
        ),
    );
  const first = targets[0];
  const resolvedText = mixed || first === undefined ? "" : effectiveText(first, projectScope);
  const dirty = mixed ? input.edited : input.edited && input.draft !== resolvedText;
  const { summary, statusLine } = roleInstructionSummary({ projectScope, mixed, dirty, targets });
  const explicit = targets.map((target) => explicitText(target, projectScope));
  const showReset = explicit.some((text) => text !== undefined);
  const prior = explicit[0];
  const undoText =
    showReset && prior !== undefined && explicit.every((text) => Equal.equals(text, prior))
      ? prior
      : undefined;
  const inherited =
    projectScope &&
    !mixed &&
    !dirty &&
    targets.length > 0 &&
    targets.every((target) => target.projectText === undefined);
  const builtIns = targets.map((target) => target.builtIn);
  const canStartFromBuiltIn =
    mixed && builtIns.length > 0 && builtIns.every((text) => Equal.equals(text, builtIns[0]));
  return {
    mixed,
    resolvedText,
    summary,
    statusLine,
    inherited,
    showReset,
    resetTooltip: resetTooltip(projectScope, targets),
    undoText,
    canStartFromBuiltIn,
    builtInText: canStartFromBuiltIn ? (builtIns[0] ?? null) : null,
  };
}

export function roleInstructionSummaryLabel(summary: RoleInstructionSummary): string {
  switch (summary) {
    case "unsaved":
      return "Unsaved";
    case "mixed":
      return "Mixed";
    case "none":
      return "None";
    case "custom":
      return "Custom";
    case "built-in":
      return "Built-in";
  }
}

/** A stable key so switching scope resets a draft even when the resolved text matches. */
export function roleInstructionScopeKey(input: {
  readonly scopeKind: string;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
}): string {
  return JSON.stringify({
    scopeKind: input.scopeKind,
    targets: input.targets.map((target) => ({
      environmentId: target.environmentId,
      projectId: target.projectId,
    })),
  });
}
