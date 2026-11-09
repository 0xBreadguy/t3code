import {
  DEFAULT_SERVER_SETTINGS,
  type LeadHandoff,
  type LeadState,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  appendLeadHandoff,
  leadThreadIdForProject,
  leadWorkerFinishMode,
  leadWorkerGuidance,
} from "./leadPolicy.ts";

const projectId = ProjectId.make("project-a");
const leadThreadId = ThreadId.make("lead:project-a");
const workerThreadId = ThreadId.make("thread-worker");
const runId = RunId.make("run-1");

const handoff = (head: string | null, summary = "done"): LeadHandoff => ({
  id: `handoff:${runId}:${head ?? "no-head"}`,
  sourceThreadId: workerThreadId,
  sourceRunId: runId,
  head,
  headSource: head === null ? null : "resolved",
  summary,
  checks: [{ name: "vp test run", outcome: "passed" }],
  reviewStatus: "review_required",
  status: "reported",
  createdAt: "2026-11-08T00:00:00.000Z",
});

describe("leadThreadIdForProject", () => {
  it("derives a stable id so a failed settings write can recover", () => {
    expect(leadThreadIdForProject(projectId)).toBe("lead:project-a");
  });
});

describe("appendLeadHandoff", () => {
  it("dedupes by source run and head without touching ownership", () => {
    const ownership = {
      id: "grant-1",
      scope: { type: "project" as const },
      actions: ["reconcile" as const],
      grantedAt: "2026-11-08T00:00:00.000Z",
      revokedAt: null,
    };
    const state: LeadState = { revision: 3, handoffs: [handoff("aaa")], ownership };
    const first = appendLeadHandoff(state, handoff("aaa"));
    expect(first.created).toBe(false);
    expect(first.state).toEqual(state);

    const second = appendLeadHandoff(state, handoff("bbb"));
    expect(second.created).toBe(true);
    expect(second.state.handoffs.map((entry) => entry.head)).toEqual(["aaa", "bbb"]);
    expect(second.state.ownership).toEqual(ownership);

    const third = appendLeadHandoff(second.state, handoff("aaa"));
    expect(third.created).toBe(false);
  });

  it("keeps only the most recent 100 records", () => {
    let state: LeadState | null = null;
    for (let index = 0; index < 105; index++) {
      const next = appendLeadHandoff(state, handoff(`head-${index}`));
      state = next.state;
    }
    expect(state?.handoffs).toHaveLength(100);
    expect(state?.handoffs[0]?.head).toBe("head-5");
  });
});

describe("worker finishing policy", () => {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectLeadConfigs: {
      [projectId]: {
        threadId: leadThreadId,
        workerDefault: "handoff" as const,
        workerFinishOverrides: { [workerThreadId]: "independent" as const },
      },
    },
  };

  it("uses the per-worker override, then the project default", () => {
    const config = settings.projectLeadConfigs[projectId]!;
    expect(leadWorkerFinishMode(config, workerThreadId)).toBe("independent");
    expect(leadWorkerFinishMode(config, ThreadId.make("other"))).toBe("handoff");
  });

  it("adds no guidance to unrelated projects or the lead thread itself", () => {
    expect(leadWorkerGuidance(settings, ProjectId.make("project-b"), workerThreadId)).toBeNull();
    expect(leadWorkerGuidance(settings, projectId, leadThreadId)).toBeNull();
    expect(leadWorkerGuidance(settings, projectId, workerThreadId)).toContain("independent");
  });
});
