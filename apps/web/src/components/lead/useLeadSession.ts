import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { LeadCapability, LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import { useEffect, useState } from "react";

import { useLeadBackend } from "../../rpc/lead";
import { useEnvironment } from "../../state/environments";

export interface LeadSessionState {
  readonly capability: LeadCapability;
  readonly data: LeadReadResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly online: boolean;
}

export function useLeadEnvironment(scope: LeadScope | null): {
  readonly capability: LeadCapability;
  readonly online: boolean;
  readonly label: string | null;
} {
  const backend = useLeadBackend();
  const environment = useEnvironment(scope?.environmentId ?? null);
  const online = environment?.connection.phase === "connected";
  const backendCapability =
    scope === null
      ? ({ kind: "unsupported", reason: "Pick a project." } as const)
      : backend.capability(scope.environmentId);
  const capability: LeadCapability = !online ? { kind: "offline", since: null } : backendCapability;
  return { capability, online, label: environment?.label ?? null };
}

/** Reads the lead's server state for one scope. Nothing is polled. */
export function useLeadSession(
  scope: LeadScope | null,
  options: { readonly enabled?: boolean } = {},
): LeadSessionState & { readonly refresh: () => void } {
  const backend = useLeadBackend();
  const { capability, online } = useLeadEnvironment(scope);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<{
    requestKey: string | null;
    data: LeadReadResult | null;
    error: string | null;
  }>({ requestKey: null, data: null, error: null });

  const scopeKey = scope === null ? null : `${scope.environmentId}\u0000${scope.projectId}`;
  const enabled = options.enabled ?? true;
  const projectId = scope?.projectId ?? null;
  const environmentId = scope?.environmentId ?? null;
  const requestKey = `${scopeKey ?? "none"}:${refreshKey}`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads server lead state for the selected scope; no polling
  useEffect(() => {
    if (
      !enabled ||
      projectId === null ||
      environmentId === null ||
      capability.kind !== "supported"
    ) {
      return;
    }
    let cancelled = false;
    backend
      .read(environmentId, { projectId })
      .then((data) => {
        if (!cancelled) setState({ requestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            requestKey,
            data: null,
            error: error instanceof Error ? error.message : "Could not read the lead.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backend, capability.kind, enabled, environmentId, projectId, requestKey]);

  const isCurrent = state.requestKey === requestKey;
  const loading = enabled && capability.kind === "supported" && projectId !== null && !isCurrent;

  return {
    capability,
    online,
    data: isCurrent ? state.data : null,
    loading,
    error: isCurrent ? state.error : null,
    refresh: () => setRefreshKey((value) => value + 1),
  };
}
