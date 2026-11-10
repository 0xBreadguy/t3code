import { describe, expect, it } from "vite-plus/test";

import {
  roleInstructionScopeKey,
  roleInstructionState,
  roleInstructionSummaryLabel,
  type RoleInstructionTarget,
} from "./roleInstructions";

const target = (overrides: Partial<RoleInstructionTarget> = {}): RoleInstructionTarget => ({
  environmentId: "environment:server",
  environmentLabel: "Server",
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
    environmentLabel: "Server",
  });

describe("roleInstructionState", () => {
  it("distinguishes absent, explicit empty, and custom text", () => {
    expect(state([target()]).summary).toBe("built-in");
    expect(roleInstructionSummaryLabel(state([target()]).summary, false, target())).toBe(
      "Built-in",
    );
    expect(state([target({ environmentText: "" })]).summary).toBe("none");
    expect(state([target({ environmentText: "Custom." })]).summary).toBe("custom");
  });

  it("keeps the project suffix for inherited and project overrides", () => {
    const projectInherited = target({ projectId: "project:1", environmentText: "Custom." });
    expect(
      roleInstructionSummaryLabel(state([projectInherited]).summary, true, projectInherited),
    ).toBe("Custom · inherited");
    const projectOverride = target({ projectId: "project:1", projectText: "Mine." });
    expect(
      roleInstructionSummaryLabel(state([projectOverride]).summary, true, projectOverride),
    ).toBe("Custom · this project");
  });

  it("treats two different effective texts as mixed and starts empty", () => {
    const mixed = state([target({ environmentText: "One." }), target({ environmentText: "Two." })]);
    expect(mixed.mixed).toBe(true);
    expect(mixed.resolvedText).toBe("");
    expect(mixed.summary).toBe("mixed");
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
    expect(state([target()], "Edited.", true).summary).toBe("unsaved");
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
      environmentLabel: "Workstation",
    });
    const second = target({
      environmentId: "environment:two",
      environmentLabel: "Workstation",
    });

    expect(roleInstructionScopeKey({ scopeKind: "all", targets: [first] })).not.toBe(
      roleInstructionScopeKey({ scopeKind: "all", targets: [second] }),
    );
  });

  it("does not collide when ids or project ids contain delimiters", () => {
    const collidingLabels = [
      target({ environmentId: "env:a|b", environmentLabel: "First", projectId: null }),
      target({ environmentId: "env:a", environmentLabel: "First", projectId: "b" }),
    ];
    const reordered = [target({ environmentId: "env:a", environmentLabel: "First" })];

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
