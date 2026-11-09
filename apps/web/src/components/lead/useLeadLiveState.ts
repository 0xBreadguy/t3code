import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { LeadReadResult, LeadState } from "@t3tools/client-runtime/rpc/lead";

import { useQuietThreadProjection } from "../../state/entities";

/**
 * The lead thread's committed projection is the live source for reports and
 * authority. `lead.read` seeds the binding; deriving state here means a worker
 * handoff or grant that commits while the panel is open appears without polling.
 */
export function useLeadLiveState(
  scope: LeadScope | null,
  data: LeadReadResult | null,
  options: { readonly enabled?: boolean } = {},
): { readonly state: LeadState | null; readonly pendingHandoffCount: number } {
  const enabled = options.enabled ?? true;
  const projection = useQuietThreadProjection(
    !enabled || scope === null || data?.thread === null || data?.thread === undefined
      ? null
      : {
          environmentId: scope.environmentId,
          threadId: data.thread.threadId,
        },
  );
  const live = projection?.projection.thread.leadState;
  const state = live !== undefined ? live : (data?.state ?? null);
  return {
    state,
    pendingHandoffCount: state?.handoffs.length ?? 0,
  };
}
