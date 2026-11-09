import type { EnvironmentId, ServerConfig, ThreadId } from "@t3tools/contracts";

import { scopedThreadKey } from "../lib/scopedEntities";

/**
 * Lead conversations are ordinary threads internally, but they are never a
 * place the user navigates to. The environment publishes its bindings in
 * settings, so lists, counts and switchers filter those ids out here.
 */
export function leadThreadKeysFromConfigs(
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [environmentId, config] of serverConfigs) {
    for (const binding of Object.values(config.settings.projectLeadConfigs)) {
      keys.add(scopedThreadKey(environmentId, binding.threadId));
    }
  }
  return keys;
}

export function isLeadThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  leadThreadKeys: ReadonlySet<string>,
): boolean {
  return leadThreadKeys.has(scopedThreadKey(environmentId, threadId));
}

export function withoutLeadThreads<
  Thread extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: ReadonlyArray<Thread>, leadThreadKeys: ReadonlySet<string>): ReadonlyArray<Thread> {
  return leadThreadKeys.size === 0
    ? threads
    : threads.filter((thread) => !isLeadThread(thread.environmentId, thread.id, leadThreadKeys));
}
