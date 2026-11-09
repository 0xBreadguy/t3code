import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { LeadBackend, LeadCapability } from "@t3tools/client-runtime/rpc/lead";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { useServerConfigs } from "../state/entities";
import { leadEnvironment } from "../state/lead";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * The single binding point for the real lead service. `LeadBackendHost`
 * adapts the typed lead RPC commands and ServerConfig.projectLead into a
 * transport; components read only the context.
 */
const LeadBackendContext = createContext<LeadBackend | null>(null);

function LeadBackendProvider({
  backend,
  children,
}: {
  readonly backend: LeadBackend;
  readonly children: ReactNode;
}) {
  return <LeadBackendContext value={backend}>{children}</LeadBackendContext>;
}

export function useLeadBackend(): LeadBackend {
  const backend = useContext(LeadBackendContext);
  if (backend === null) {
    throw new Error("useLeadBackend must be used inside LeadBackendHost.");
  }
  return backend;
}

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

/**
 * Runs inside the app shell so the command hooks can reach the environment
 * registry. Transport identity is stable; capability re-reads ServerConfig.
 */
export function LeadBackendHost({ children }: { readonly children: ReactNode }) {
  const serverConfigs = useServerConfigs();
  const configsRef = useRef(serverConfigs);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors server configs for capability reads after the commit
  useEffect(() => {
    configsRef.current = serverConfigs;
  }, [serverConfigs]);

  const ensureCommand = useAtomCommand(leadEnvironment.ensure, { reportFailure: false });
  const readCommand = useAtomCommand(leadEnvironment.read, { reportFailure: false });
  const sendCommand = useAtomCommand(leadEnvironment.send, { reportFailure: false });
  const grantCommand = useAtomCommand(leadEnvironment.grant, { reportFailure: false });
  const revokeCommand = useAtomCommand(leadEnvironment.revoke, { reportFailure: false });
  const ensure = useStableCallback(ensureCommand);
  const read = useStableCallback(readCommand);
  const send = useStableCallback(sendCommand);
  const grant = useStableCallback(grantCommand);
  const revoke = useStableCallback(revokeCommand);

  const [backend] = useState<LeadBackend>(() => ({
    capability: (environmentId) => {
      const config = configsRef.current.get(environmentId);
      if (config?.projectLead === true) {
        // Text-only until LeadSendInput accepts context refs.
        return { kind: "supported", contextRefs: false } satisfies LeadCapability;
      }
      return {
        kind: "unsupported",
        reason: "This server needs an update to use the lead.",
      } satisfies LeadCapability;
    },
    ensure: async (environmentId, input) => unwrap(await ensure({ environmentId, input })),
    read: async (environmentId, input) => unwrap(await read({ environmentId, input })),
    send: async (environmentId, input) => unwrap(await send({ environmentId, input })),
    grant: async (environmentId, input) => unwrap(await grant({ environmentId, input })),
    revoke: async (environmentId, input) => unwrap(await revoke({ environmentId, input })),
  }));
  return <LeadBackendProvider backend={backend}>{children}</LeadBackendProvider>;
}
