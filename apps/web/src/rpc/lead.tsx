import { unavailableLeadBackend, type LeadBackend } from "@t3tools/client-runtime/rpc/lead";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The single binding point for a real lead service. Until the server contract
 * lands, the default reports unsupported and every lead action explains why.
 */
const LeadBackendContext = createContext<LeadBackend>(unavailableLeadBackend);

export function LeadBackendProvider({
  backend,
  children,
}: {
  readonly backend: LeadBackend;
  readonly children: ReactNode;
}) {
  return <LeadBackendContext value={backend}>{children}</LeadBackendContext>;
}

export function useLeadBackend(): LeadBackend {
  return useContext(LeadBackendContext);
}
