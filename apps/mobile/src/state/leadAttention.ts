import type { EnvironmentId, ServerConfig, ThreadId } from "@t3tools/contracts";

export interface LeadThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

/** One configured lead conversation per project, keyed by its environment. */
export function leadThreadRefsFromConfigs(
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
): ReadonlyArray<LeadThreadRef> {
  const refs: LeadThreadRef[] = [];
  for (const [environmentId, config] of serverConfigs) {
    for (const binding of Object.values(config.settings.projectLeadConfigs)) {
      refs.push({ environmentId, threadId: binding.threadId });
    }
  }
  return refs;
}

type LeadThreadAttention = {
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
};

/**
 * Counts lead conversations, not individual provider requests: a thread shell
 * carries one `pendingRuntimeRequest`, so it only proves that thread needs you.
 */
export function countLeadThreadsNeedingAttention(
  refs: ReadonlyArray<LeadThreadRef>,
  shellFor: (ref: LeadThreadRef) => LeadThreadAttention | null,
): number {
  let count = 0;
  for (const ref of refs) {
    const shell = shellFor(ref);
    if (shell !== null && (shell.hasPendingApprovals || shell.hasPendingUserInput)) count += 1;
  }
  return count;
}
