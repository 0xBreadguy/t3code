import type { EnvironmentId, ServerConfig, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isLeadThread, leadThreadKeysFromConfigs, withoutLeadThreads } from "./leadThreadFilter";

function configWithLeads(leadThreadIds: ReadonlyArray<string>): ServerConfig {
  return {
    settings: {
      projectLeadConfigs: Object.fromEntries(
        leadThreadIds.map((threadId) => [`project-${threadId}`, { threadId }]),
      ),
    },
  } as unknown as ServerConfig;
}

function shell(environmentId: string, id: string) {
  return {
    environmentId: environmentId as EnvironmentId,
    id: id as ThreadId,
  };
}

describe("lead thread filtering", () => {
  it("collects each environment's configured lead thread", () => {
    const keys = leadThreadKeysFromConfigs(
      new Map<EnvironmentId, ServerConfig>([
        ["env-a" as EnvironmentId, configWithLeads(["lead-a"])],
        ["env-b" as EnvironmentId, configWithLeads(["lead-b"])],
      ]),
    );

    expect(keys.size).toBe(2);
    expect(isLeadThread("env-a" as EnvironmentId, "lead-a" as ThreadId, keys)).toBe(true);
    expect(isLeadThread("env-b" as EnvironmentId, "lead-a" as ThreadId, keys)).toBe(false);
  });

  it("leaves lists untouched when no lead is configured", () => {
    const threads = [shell("env-a", "thread-a")];
    expect(withoutLeadThreads(threads, new Set())).toBe(threads);
  });

  it("drops only the configured ids from the same environment", () => {
    const keys = leadThreadKeysFromConfigs(
      new Map<EnvironmentId, ServerConfig>([
        ["env-a" as EnvironmentId, configWithLeads(["lead-a"])],
      ]),
    );
    const threads = [
      shell("env-a", "thread-a"),
      shell("env-a", "lead-a"),
      shell("env-b", "lead-a"),
    ];

    expect(
      withoutLeadThreads(threads, keys).map((thread) => `${thread.environmentId}:${thread.id}`),
    ).toEqual(["env-a:thread-a", "env-b:lead-a"]);
  });
});
