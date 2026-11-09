import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { leadScopeKey } from "@t3tools/client-runtime/lead/scope";
import type { LeadCapability, LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { leadEnvironment, leadErrorMessage, unwrapLeadResult } from "../../state/lead";
import { useAtomCommand } from "../../state/use-atom-command";
import { useQuietThreadStructure } from "../../state/use-thread-detail";

const RUNNING_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

export interface LeadEnvironmentState {
  readonly capability: LeadCapability;
  readonly online: boolean;
  readonly label: string;
}

/** Capability is the client's only gate; offline outranks the server's own support. */
function useLeadEnvironment(scope: LeadScope | null): LeadEnvironmentState {
  const { presentationById } = useEnvironments();
  const presentation = scope === null ? undefined : presentationById.get(scope.environmentId);
  const online = presentation?.connection.phase === "connected";
  const capability: LeadCapability =
    scope === null
      ? { kind: "unsupported", reason: "Pick a project." }
      : !online
        ? { kind: "offline", since: null }
        : presentation?.serverConfig?.projectLead === true
          ? { kind: "supported", contextRefs: true }
          : { kind: "unsupported", reason: "This server needs an update to use the lead." };
  return {
    capability,
    online,
    label: presentation?.entry.target.label ?? "this environment",
  };
}

export interface LeadSessionState extends LeadEnvironmentState {
  readonly data: LeadReadResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

interface LeadReadSnapshot {
  readonly scopeKey: string | null;
  readonly requestKey: string | null;
  readonly data: LeadReadResult | null;
  readonly error: string | null;
}

/** Reads the lead's server state for one scope. Nothing is polled. */
export function useLeadSession(
  scope: LeadScope | null,
  options: { readonly enabled?: boolean } = {},
): LeadSessionState {
  const environment = useLeadEnvironment(scope);
  const read = useAtomCommand(leadEnvironment.read, { reportFailure: false });
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<LeadReadSnapshot>({
    scopeKey: null,
    requestKey: null,
    data: null,
    error: null,
  });

  const enabled = options.enabled ?? true;
  const environmentId = scope?.environmentId ?? null;
  const projectId = scope?.projectId ?? null;
  const scopeKey = scope === null ? null : leadScopeKey(scope);
  const requestKey = `${scopeKey ?? "none"}:${refreshKey}`;
  const supported = environment.capability.kind === "supported";

  const readState = useEffectEvent(
    async (request: {
      readonly environmentId: NonNullable<typeof environmentId>;
      readonly projectId: NonNullable<typeof projectId>;
    }) => {
      try {
        const data = unwrapLeadResult(
          await read({
            environmentId: request.environmentId,
            input: { projectId: request.projectId },
          }),
        );
        return { data, error: null };
      } catch (error) {
        return { data: null, error: leadErrorMessage(error, "Couldn't read the lead.") };
      }
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the server's lead state for the selected scope; no polling
  useEffect(() => {
    if (!enabled || !supported || environmentId === null || projectId === null) return;
    let cancelled = false;
    void readState({ environmentId, projectId }).then((result) => {
      if (!cancelled) setState({ scopeKey, requestKey, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, supported, environmentId, projectId, scopeKey, requestKey]);

  // A refresh keeps the scope's last answer; switching projects never shows it.
  const sameScope = state.scopeKey === scopeKey;
  const isCurrent = sameScope && state.requestKey === requestKey;
  return {
    ...environment,
    data: supported && sameScope ? state.data : null,
    loading: enabled && supported && !isCurrent,
    error: supported && sameScope ? state.error : null,
    refresh: () => setRefreshKey((value) => value + 1),
  };
}

export function leadThreadRef(
  scope: LeadScope | null,
  data: LeadReadResult | null,
  pendingThreadId: ScopedThreadRef["threadId"] | null = null,
): ScopedThreadRef | null {
  if (scope === null) return null;
  const threadId = pendingThreadId ?? data?.thread?.threadId ?? null;
  return threadId === null ? null : { environmentId: scope.environmentId, threadId };
}

/** Reads runs without re-rendering on every streamed assistant chunk. */
export function useLeadRunning(threadRef: ScopedThreadRef | null): boolean {
  const structure = useQuietThreadStructure(threadRef);
  return structure?.projection.runs.some((run) => RUNNING_RUN_STATUSES.has(run.status)) ?? false;
}
