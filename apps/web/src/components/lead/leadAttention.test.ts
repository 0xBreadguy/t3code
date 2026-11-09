import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  countLeadsNeedingYou,
  deriveLeadAttention,
  leadsNeedingYouScopes,
  pendingRequestNeedsUser,
  sameLeadAttention,
  type LeadAttentionInput,
  type LeadAttentionShell,
} from "./leadAttention.logic";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");

function shell(
  pendingRuntimeRequest: LeadAttentionShell["pendingRuntimeRequest"],
  status: LeadAttentionShell["status"] = "idle",
  archived = false,
): LeadAttentionShell {
  return {
    status,
    pendingRuntimeRequest,
    archivedAt: archived ? DateTime.makeUnsafe("2026-11-08T00:00:00.000Z") : null,
  };
}

function lead(
  shellValue: LeadAttentionShell | null,
  overrides: Partial<Omit<LeadAttentionInput, "shell">> = {},
): LeadAttentionInput {
  return {
    environmentId,
    projectId,
    threadId,
    ...overrides,
    shell: shellValue,
  };
}

describe("pendingRequestNeedsUser", () => {
  it("counts approvals and questions, not background auth refreshes", () => {
    expect(pendingRequestNeedsUser({ kind: "permission" }, "idle")).toBe(true);
    expect(pendingRequestNeedsUser({ kind: "command" }, "waiting")).toBe(true);
    expect(pendingRequestNeedsUser({ kind: "user_input", blocking: true }, "idle")).toBe(true);
    expect(pendingRequestNeedsUser({ kind: "user_input" }, "running")).toBe(true);
    expect(pendingRequestNeedsUser({ kind: "auth_refresh" }, "idle")).toBe(false);
    expect(pendingRequestNeedsUser(null, "running")).toBe(false);
  });

  it("lets a non-blocking question wait until the run stops working", () => {
    const question = { kind: "user_input", blocking: false } as const;
    expect(pendingRequestNeedsUser(question, "preparing")).toBe(false);
    expect(pendingRequestNeedsUser(question, "running")).toBe(false);
    expect(pendingRequestNeedsUser(question, "waiting")).toBe(true);
    expect(pendingRequestNeedsUser(question, "idle")).toBe(true);
  });
});

describe("deriveLeadAttention", () => {
  it("reads needs-you from the shell and ignores archived or missing leads", () => {
    const records = deriveLeadAttention([
      lead(shell({ kind: "permission" })),
      lead(shell({ kind: "user_input", blocking: false }, "running")),
      lead(shell({ kind: "permission" }, "idle", true)),
      lead(null),
      lead(shell(null), { threadId: ThreadId.make("other-thread") }),
    ]);

    expect(records.map((record) => record.needsYou)).toEqual([true, false, false, false, false]);
    expect(records.map((record) => record.requestKind)).toEqual([
      "approval",
      "user_input",
      null,
      null,
      null,
    ]);
  });

  it("counts lead threads, not requests inside one turn", () => {
    const attention = deriveLeadAttention([
      lead(shell({ kind: "permission" })),
      lead(shell({ kind: "user_input" }), { projectId: ProjectId.make("other-project") }),
      lead(shell(null)),
    ]);
    expect(countLeadsNeedingYou(attention)).toBe(2);
    expect(leadsNeedingYouScopes(attention).size).toBe(2);
  });

  it("keeps an unchanged list so the closed button does not re-render on shell ticks", () => {
    const previous = deriveLeadAttention([lead(shell({ kind: "permission" }))]);
    const next = deriveLeadAttention([lead(shell({ kind: "permission" }))]);
    expect(sameLeadAttention(previous, next)).toBe(true);
    expect(sameLeadAttention(previous, deriveLeadAttention([lead(shell(null))]))).toBe(false);
  });
});
