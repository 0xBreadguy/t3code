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
  isAppointedLead,
  leadAppointedGuidance,
  leadThreadIdForProject,
  leadTurnGuidance,
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

describe("appointed lead guidance", () => {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    projectLeadConfigs: {
      [projectId]: {
        threadId: leadThreadId,
        workerDefault: "handoff" as const,
        workerFinishOverrides: {},
      },
    },
  };

  it("applies only to the appointed lead and carries its real reports and grant terms", () => {
    expect(isAppointedLead(settings, projectId, leadThreadId)).toBe(true);
    expect(isAppointedLead(settings, projectId, workerThreadId)).toBe(false);
    expect(
      leadAppointedGuidance({
        settings,
        projectId,
        threadId: workerThreadId,
        projectTitle: "Parser",
        leadState: null,
      }),
    ).toBeNull();

    const guidance = leadAppointedGuidance({
      settings,
      projectId,
      threadId: leadThreadId,
      projectTitle: "Parser",
      leadState: {
        revision: 4,
        handoffs: [handoff("aaa", "A secret worker summary")],
        ownership: {
          id: "grant-1",
          scope: { type: "threads", threadIds: [workerThreadId] },
          actions: ["reconcile", "open_pr"],
          grantedAt: "2026-11-08T00:01:00.000Z",
          revokedAt: null,
        },
      },
    });
    expect(guidance).toContain('project "Parser" (project-a)');
    expect(guidance).toContain("1 worker report is recorded");
    expect(guidance).toContain("lead_status");
    expect(guidance).toContain("Reported is not verified");
    expect(guidance).toContain("Only the user can grant authority");
    expect(guidance).toContain("grant-1");
    expect(guidance).toContain("threads thread-worker");
    expect(guidance).toContain("reconcile, open_pr");
    expect(guidance).toContain("not a shell sandbox");
    expect(guidance).not.toContain("A secret worker summary");
  });

  it("reports a revoked grant and never treats it as authority", () => {
    const guidance = leadAppointedGuidance({
      settings,
      projectId,
      threadId: leadThreadId,
      leadState: {
        revision: 5,
        handoffs: [],
        ownership: {
          id: "grant-2",
          scope: { type: "project" },
          actions: ["merge"],
          grantedAt: "2026-11-08T00:01:00.000Z",
          revokedAt: "2026-11-08T00:02:00.000Z",
        },
      },
    });
    expect(guidance).toContain("No worker reports are recorded yet");
    expect(guidance).toContain("grant-2 was revoked");
    expect(guidance).toContain("Do not start a new managed action");
  });

  it("chooses worker, lead, or no guidance at the shared turn boundary", () => {
    const base = { settings, projectId, projectTitle: "Parser" };
    expect(leadTurnGuidance({ ...base, threadId: leadThreadId })).toContain("## Project lead");
    expect(leadTurnGuidance({ ...base, threadId: workerThreadId })).toContain(
      "## Finishing work for this project",
    );
    expect(leadTurnGuidance({ ...base, threadId: workerThreadId })).not.toContain(
      "## Project lead",
    );
    expect(
      leadTurnGuidance({
        ...base,
        projectId: ProjectId.make("project-b"),
        threadId: workerThreadId,
      }),
    ).toBeNull();
  });
});
