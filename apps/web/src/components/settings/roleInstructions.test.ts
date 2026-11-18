import { describe, expect, it } from "vite-plus/test";

import {
  roleInstructionScopeKey,
  roleInstructionState,
  roleInstructionSummaryLabel,
  type RoleInstructionTarget,
} from "./roleInstructions";

const target = (overrides: Partial<RoleInstructionTarget> = {}): RoleInstructionTarget => ({
  environmentId: "environment:server",
  projectId: null,
  builtIn: "Built-in text.",
  projectText: undefined,
  environmentText: undefined,
  ...overrides,
});

const state = (targets: ReadonlyArray<RoleInstructionTarget>, draft = "", edited = false) =>
  roleInstructionState({
    projectScope: targets[0]?.projectId !== null && targets[0]?.projectId !== undefined,
    targets,
    draft,
    edited,
  });

describe("roleInstructionState", () => {
  it("distinguishes absent, explicit empty, and custom text", () => {
    expect(state([target()]).summary).toBe("built-in");
    expect(state([target({ environmentText: "" })]).summary).toBe("none");
    expect(state([target({ environmentText: "Custom." })]).summary).toBe("custom");
    expect(roleInstructionSummaryLabel("built-in")).toBe("Built-in");
    expect(roleInstructionSummaryLabel("none")).toBe("None");
    expect(roleInstructionSummaryLabel("custom")).toBe("Custom");
  });

  it("labels a project override without saying where the text came from", () => {
    const projectInherited = target({ projectId: "project:1", environmentText: "Custom." });
    expect(state([projectInherited]).summary).toBe("custom");
    expect(state([projectInherited]).showReset).toBe(false);
    const projectOverride = target({ projectId: "project:1", projectText: "Mine." });
    expect(state([projectOverride]).summary).toBe("custom");
    expect(state([projectOverride]).showReset).toBe(true);
    expect(roleInstructionSummaryLabel(state([projectOverride]).summary)).toBe("Custom");
  });

  it("reads as inherited only on a project with no saved text of its own", () => {
    const inherited = state([target({ projectId: "project:1", environmentText: "Custom." })]);
    expect(inherited.inherited).toBe(true);
    const override = state([target({ projectId: "project:1", projectText: "Mine." })]);
    expect(override.inherited).toBe(false);
    const cleared = state([target({ projectId: "project:1", projectText: "" })]);
    expect(cleared.inherited).toBe(false);
    expect(
      state([target({ projectId: "project:1", environmentText: "Custom." })], "Typing.", true)
        .inherited,
    ).toBe(false);
    expect(state([target({ environmentText: "Custom." })]).inherited).toBe(false);
    expect(state([target()]).inherited).toBe(false);
  });

  it("names what a reset falls back to", () => {
    expect(
      state([target({ projectId: "project:1", environmentText: "Custom." })]).resetTooltip,
    ).toBe("Reset to inherited value (Custom)");
    expect(state([target({ projectId: "project:1" })]).resetTooltip).toBe(
      "Reset to inherited value (Built-in)",
    );
    expect(state([target({ projectId: "project:1", environmentText: "" })]).resetTooltip).toBe(
      "Reset to inherited value (None)",
    );
    expect(
      state([
        target({ projectId: "project:1", projectText: "Mine.", environmentText: "" }),
        target({ projectId: "project:1", projectText: "Mine.", environmentText: "Two." }),
      ]).resetTooltip,
    ).toBe("Reset to inherited value");
    expect(state([target({ environmentText: "Custom." })]).resetTooltip).toBe("Reset to built-in");
    expect(state([target()]).resetTooltip).toBe("Reset to built-in");
  });

  it("treats two different effective texts as mixed and starts empty", () => {
    const mixed = state([target({ environmentText: "One." }), target({ environmentText: "Two." })]);
    expect(mixed.mixed).toBe(true);
    expect(mixed.resolvedText).toBe("");
    expect(mixed.summary).toBe("mixed");
    expect(mixed.statusLine).toBe(
      "Different on the selected environments. Saving writes this text to each one.",
    );
    expect(mixed.inherited).toBe(false);
    expect(mixed.canStartFromBuiltIn).toBe(true);
  });

  it("offers undo only when every target shares the same prior override", () => {
    expect(state([target({ environmentText: "Same." })]).undoText).toBe("Same.");
    expect(
      state([target({ environmentText: "One." }), target({ environmentText: "Two." })]).undoText,
    ).toBeUndefined();
    expect(
      state([target({ environmentText: "" }), target({ environmentText: undefined })]).undoText,
    ).toBeUndefined();
    expect(state([target({ environmentText: "" })]).undoText).toBe("");
  });

  it("does not report dirty until an edit happens, then keeps the draft", () => {
    expect(state([target()], "Built-in text.", false).summary).toBe("built-in");
    expect(state([target()], "Built-in text.", false).statusLine).toBe("");
    expect(state([target()], "Edited.", true).summary).toBe("unsaved");
    expect(state([target()], "Edited.", true).statusLine).toBe("Unsaved changes");
    const mixed = state(
      [target({ environmentText: "One." }), target({ environmentText: "Two." })],
      "",
      false,
    );
    expect(mixed.summary).toBe("mixed");
    expect(
      state([target({ environmentText: "One." }), target({ environmentText: "Two." })], "", true)
        .summary,
    ).toBe("unsaved");
  });
});

describe("roleInstructionScopeKey", () => {
  it("separates equal labels with different stable environment ids", () => {
    const first = target({
      environmentId: "environment:one",
    });
    const second = target({
      environmentId: "environment:two",
    });

    expect(roleInstructionScopeKey({ scopeKind: "all", targets: [first] })).not.toBe(
      roleInstructionScopeKey({ scopeKind: "all", targets: [second] }),
    );
  });

  it("does not collide when ids or project ids contain delimiters", () => {
    const collidingLabels = [
      target({ environmentId: "env:a|b", projectId: null }),
      target({ environmentId: "env:a", projectId: "b" }),
    ];
    const reordered = [target({ environmentId: "env:a" })];

    expect(
      roleInstructionScopeKey({ scopeKind: "environment", targets: collidingLabels }),
    ).not.toBe(roleInstructionScopeKey({ scopeKind: "environment", targets: reordered }));
    expect(
      roleInstructionScopeKey({
        scopeKind: "project",
        targets: [target({ environmentId: "env:a", projectId: "project:1|2" })],
      }),
    ).not.toBe(
      roleInstructionScopeKey({
        scopeKind: "project",
        targets: [target({ environmentId: "env:a", projectId: "project:1" })],
      }),
    );
  });

  it("separates scope kinds that write to the same environment", () => {
    const targets = [target({ environmentId: "environment:one" })];

    expect(roleInstructionScopeKey({ scopeKind: "all", targets })).not.toBe(
      roleInstructionScopeKey({ scopeKind: "environment", targets }),
    );
  });
});
