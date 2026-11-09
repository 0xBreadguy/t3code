import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  countLeadThreadsNeedingAttention,
  leadThreadRefsFromConfigs,
  type LeadThreadRef,
} from "./leadAttention";

function configWithLeads(leads: ReadonlyArray<{ project: string; thread: string }>): ServerConfig {
  return {
    settings: {
      projectLeadConfigs: Object.fromEntries(
        leads.map((lead) => [`project-${lead.project}`, { threadId: lead.thread }]),
      ),
    },
  } as unknown as ServerConfig;
}

const env = EnvironmentId.make("env-a");

describe("lead attention", () => {
  it("collects configured lead threads per environment", () => {
    expect(
      leadThreadRefsFromConfigs(
        new Map([
          [env, configWithLeads([{ project: "a", thread: "lead-a" }])],
          [EnvironmentId.make("env-b"), configWithLeads([{ project: "b", thread: "lead-b" }])],
        ]),
      ),
    ).toEqual([
      { environmentId: env, threadId: ThreadId.make("lead-a") },
      { environmentId: EnvironmentId.make("env-b"), threadId: ThreadId.make("lead-b") },
    ]);
  });

  it("counts lead threads with a pending request, not vanished threads", () => {
    const refs: ReadonlyArray<LeadThreadRef> = [
      { environmentId: env, threadId: ThreadId.make("lead-a") },
      { environmentId: env, threadId: ThreadId.make("lead-b") },
      { environmentId: env, threadId: ThreadId.make("lead-c") },
    ];
    const shells = new Map<string, { hasPendingApprovals: boolean; hasPendingUserInput: boolean }>([
      [String(refs[0]!.threadId), { hasPendingApprovals: true, hasPendingUserInput: false }],
      [String(refs[1]!.threadId), { hasPendingApprovals: false, hasPendingUserInput: true }],
      [String(refs[2]!.threadId), { hasPendingApprovals: false, hasPendingUserInput: false }],
    ]);
    expect(
      countLeadThreadsNeedingAttention(refs, (ref) => shells.get(String(ref.threadId)) ?? null),
    ).toBe(2);
  });

  it("returns zero when no lead is configured", () => {
    expect(countLeadThreadsNeedingAttention(leadThreadRefsFromConfigs(new Map()), () => null)).toBe(
      0,
    );
  });
});
