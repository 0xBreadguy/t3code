import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_ROLE_INSTRUCTION_MAX_LENGTH,
  AgentRole,
  AgentRoleInstructionDefaults,
  AgentRoleInstructionPatch,
  AgentRoleInstructions,
  AgentRoleModelSelectionPatch,
  AgentRoleModelSelections,
} from "./agentRoles.ts";

describe("agent role instructions schema", () => {
  const decodeInstructions = Schema.decodeUnknownSync(AgentRoleInstructions);
  const decodePatch = Schema.decodeUnknownSync(AgentRoleInstructionPatch);

  it("keeps exact text, an explicit empty string, and unknown role keys", () => {
    const text = "  Keep the blank line.\n\nAnd this indentation.  ";
    expect(decodeInstructions({ review: text, future_role: "unknown" })).toMatchObject({
      review: text,
      future_role: "unknown",
    });
    expect(decodeInstructions({ review: "" }).review).toBe("");
  });

  it("bounds each role at 8,000 characters", () => {
    expect(AGENT_ROLE_INSTRUCTION_MAX_LENGTH).toBe(8_000);
    expect(() =>
      decodeInstructions({ review: "x".repeat(AGENT_ROLE_INSTRUCTION_MAX_LENGTH + 1) }),
    ).toThrow();
    expect(decodePatch({ review: null, design: "" }).review).toBeNull();
  });

  it("stores unknown role keys from a newer server without failing", () => {
    const decodeModels = Schema.decodeUnknownSync(AgentRoleModelSelections);
    expect(
      decodeModels({
        review: { instanceId: "codex", model: "gpt-5" },
        future_role: { instanceId: "muse", model: "x" },
      }),
    ).toMatchObject({ future_role: { instanceId: "muse", model: "x" } });
  });
});

describe("security role schema compatibility", () => {
  const decodeDefaults = Schema.decodeSync(AgentRoleInstructionDefaults);
  const decodeRole = Schema.decodeSync(AgentRole);
  const decodeModelPatch = Schema.decodeSync(AgentRoleModelSelectionPatch);
  const decodeInstructionPatch = Schema.decodeSync(AgentRoleInstructionPatch);
  const eightRoleDefaults = {
    architecture: "Architecture",
    implementation: "Implementation",
    research: "Research",
    review: "Review",
    design: "Design",
    test: "Test",
    general: "General",
  };

  it("decodes an older server's eight-role defaults without inventing security", () => {
    expect(decodeDefaults(eightRoleDefaults).security).toBeUndefined();
  });

  it("accepts security in the advertised defaults when a server knows the role", () => {
    expect(decodeDefaults({ ...eightRoleDefaults, security: "Security text." }).security).toBe(
      "Security text.",
    );
    expect(decodeRole("security")).toBe("security");
  });

  it("round-trips a security model or instruction patch", () => {
    expect(
      decodeModelPatch({
        security: { instanceId: "claudeAgent", model: "opus-5" },
      }).security,
    ).toEqual({ instanceId: "claudeAgent", model: "opus-5" });
    expect(decodeInstructionPatch({ security: "Audit text." }).security).toBe("Audit text.");
    expect(decodeInstructionPatch({ security: null }).security).toBeNull();
  });

  it("keeps the delegable set to the eight work roles", () => {
    expect([...AgentRole.literals]).toEqual([
      "architecture",
      "implementation",
      "research",
      "review",
      "security",
      "design",
      "test",
      "general",
    ]);
  });
});
