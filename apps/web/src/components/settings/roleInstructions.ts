import * as Equal from "effect/Equal";

export interface RoleInstructionTarget {
  /** Stable identity; labels are display text and can collide or change. */
  readonly environmentId: string;
  readonly environmentLabel: string;
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
  readonly resetLabel: "Use built-in" | "Use inherited";
  readonly showReset: boolean;
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

function roleInstructionSummary(input: {
  readonly projectScope: boolean;
  readonly mixed: boolean;
  readonly dirty: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
  readonly environmentLabel: string;
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
    return { summary: "built-in", statusLine: "T3's built-in instructions." };
  }
  if (input.projectScope) {
    if (target.projectText !== undefined) {
      return target.projectText === ""
        ? { summary: "none", statusLine: "No extra instructions for this project." }
        : { summary: "custom", statusLine: "Set for this project." };
    }
    return {
      summary:
        effectiveText(target, true) === target.builtIn
          ? "built-in"
          : effectiveText(target, true) === ""
            ? "none"
            : "custom",
      statusLine: `Inherited from ${target.environmentLabel}. Saving creates a project override.`,
    };
  }
  const environment =
    input.targets.length > 1 ? "the selected environments" : input.environmentLabel;
  if (target.environmentText === undefined) {
    return {
      summary: "built-in",
      statusLine: `T3's built-in instructions. Edits are saved as your copy on ${environment}.`,
    };
  }
  if (target.environmentText === "") {
    return { summary: "none", statusLine: `No extra instructions on ${environment}.` };
  }
  return { summary: "custom", statusLine: `Your instructions on ${environment}.` };
}

export function roleInstructionState(input: {
  readonly projectScope: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
  readonly draft: string;
  readonly edited: boolean;
  readonly environmentLabel: string;
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
  const { summary, statusLine } = roleInstructionSummary({
    projectScope,
    mixed,
    dirty,
    targets,
    environmentLabel: input.environmentLabel,
  });
  const explicit = targets.map((target) => explicitText(target, projectScope));
  const showReset = explicit.some((text) => text !== undefined);
  const prior = explicit[0];
  const undoText =
    showReset && prior !== undefined && explicit.every((text) => Equal.equals(text, prior))
      ? prior
      : undefined;
  const builtIns = targets.map((target) => target.builtIn);
  const canStartFromBuiltIn =
    mixed && builtIns.length > 0 && builtIns.every((text) => Equal.equals(text, builtIns[0]));
  return {
    mixed,
    resolvedText,
    summary,
    statusLine,
    resetLabel: projectScope ? "Use inherited" : "Use built-in",
    showReset,
    undoText,
    canStartFromBuiltIn,
    builtInText: canStartFromBuiltIn ? (builtIns[0] ?? null) : null,
  };
}

export function roleInstructionSummaryLabel(
  summary: RoleInstructionSummary,
  projectScope: boolean,
  target: RoleInstructionTarget | undefined,
): string {
  switch (summary) {
    case "unsaved":
      return "Unsaved";
    case "mixed":
      return "Mixed";
    case "none":
      return projectScope
        ? `None${target?.projectText !== undefined ? " · this project" : " · inherited"}`
        : "None";
    case "custom":
      return projectScope
        ? `Custom${target?.projectText !== undefined ? " · this project" : " · inherited"}`
        : "Custom";
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
