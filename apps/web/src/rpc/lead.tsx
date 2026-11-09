import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { LeadBackend, LeadCapability } from "@t3tools/client-runtime/rpc/lead";
import { createContext, useContext, useState, type ReactNode } from "react";

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
 * registry. The transport is rebuilt only when server configs change, so a
 * capability arriving after connection takes effect without polling.
 */
export function LeadBackendHost({ children }: { readonly children: ReactNode }) {
  const serverConfigs = useServerConfigs();
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

  const createBackend = (): LeadBackend => ({
    capability: (environmentId) => {
      const config = serverConfigs.get(environmentId);
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
  });

  const [snapshot, setSnapshot] = useState(() => ({
    configs: serverConfigs,
    backend: createBackend(),
  }));
  if (snapshot.configs !== serverConfigs) {
    const backend = createBackend();
    setSnapshot({ configs: serverConfigs, backend });
    return <LeadBackendProvider backend={backend}>{children}</LeadBackendProvider>;
  }
  return <LeadBackendProvider backend={snapshot.backend}>{children}</LeadBackendProvider>;
}
