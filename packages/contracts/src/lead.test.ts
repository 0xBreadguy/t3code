import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  LeadHandoff,
  LeadSendInput,
  LeadState,
  leadStateRevisionProblem,
  ProjectLeadConfig,
} from "./lead.ts";
import { OrchestrationV2LeadState } from "./orchestrationV2.ts";

const decodeLeadHandoff = Schema.decodeUnknownSync(LeadHandoff);
const decodeLeadState = Schema.decodeUnknownSync(LeadState);
const decodeOrchestrationLeadState = Schema.decodeUnknownSync(OrchestrationV2LeadState);
const decodeProjectLeadConfig = Schema.decodeUnknownSync(ProjectLeadConfig);

describe("lead state revision", () => {
  it("accepts the one-step compare-and-swap a service writes", () => {
    expect(
      leadStateRevisionProblem({ currentRevision: 2, expectedRevision: 2, nextRevision: 3 }),
    ).toBeNull();
    expect(
      leadStateRevisionProblem({
        currentRevision: undefined,
        expectedRevision: 0,
        nextRevision: 1,
      }),
    ).toBeNull();
  });

  it("rejects a stale write and a skipped revision", () => {
    expect(
      leadStateRevisionProblem({ currentRevision: 2, expectedRevision: 1, nextRevision: 3 }),
    ).toBe("stale_revision");
    expect(
      leadStateRevisionProblem({ currentRevision: 2, expectedRevision: 2, nextRevision: 4 }),
    ).toBe("non_monotonic_revision");
    expect(
      leadStateRevisionProblem({
        currentRevision: 0,
        expectedRevision: undefined,
        nextRevision: 1,
      }),
    ).toBe("stale_revision");
  });
});

describe("lead state schemas", () => {
  const handoff = {
    id: "handoff:run-1:abc",
    sourceThreadId: "thread-worker",
    sourceRunId: "run-1",
    head: "abc",
    headSource: "resolved" as const,
    summary: "Changed the parser and ran focused tests.",
    checks: [{ name: "vp test run", outcome: "passed" as const }],
    reviewStatus: "review_required" as const,
    status: "reported" as const,
    createdAt: "2026-11-08T00:00:00.000Z",
  };

  it("keeps reported checks as plain reports with a review-required status", () => {
    const decoded = decodeLeadHandoff(handoff);
    expect(decoded.reviewStatus).toBe("review_required");
    expect(decoded.checks[0]).toEqual({ name: "vp test run", outcome: "passed" });
  });

  it("bounds stored history and decodes old state without ownership", () => {
    const decode = decodeOrchestrationLeadState;
    expect(decode({ revision: 1, handoffs: [handoff] }).ownership).toBeNull();
    expect(() =>
      decode({
        revision: 1,
        handoffs: Array.from({ length: 101 }, (_, index) => ({
          ...handoff,
          id: `handoff-${index}`,
          head: `head-${index}`,
        })),
      }),
    ).toThrow();
    expect(decodeLeadState({ revision: 1, handoffs: [] }).ownership).toBeNull();
  });
});

describe("project lead config", () => {
  it("keeps a sparse per-worker override map", () => {
    expect(
      decodeProjectLeadConfig({
        threadId: "lead:project-a",
        workerDefault: "handoff",
      }),
    ).toMatchObject({ workerDefault: "handoff", workerFinishOverrides: {} });
  });
});

describe("lead send context", () => {
  const decodeLeadSend = Schema.decodeUnknownSync(LeadSendInput);
  const send = {
    projectId: "project-a",
    commandId: "command-1",
    messageId: "message-1",
    text: "Review the change.",
  };

  it("keeps the old text-only send valid", () => {
    expect(decodeLeadSend(send).context).toBeUndefined();
  });

  it("accepts existing composer context records with the message", () => {
    const decoded = decodeLeadSend({
      ...send,
      context: {
        version: 1,
        records: [
          {
            version: 1,
            contextId: "ctx-worker",
            label: "Worker",
            kind: "thread",
            environmentId: "environment-a",
            threadId: "thread-worker",
            title: "Worker",
          },
        ],
      },
    });
    expect(decoded.context?.records[0]).toMatchObject({
      kind: "thread",
      threadId: "thread-worker",
    });
  });
});
