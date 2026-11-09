import { LEAD_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createLeadCommands<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    ensure: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lead:ensure",
      tag: LEAD_WS_METHODS.ensure,
    }),
    read: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lead:read",
      tag: LEAD_WS_METHODS.read,
    }),
    send: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lead:send",
      tag: LEAD_WS_METHODS.send,
    }),
    grant: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lead:grant",
      tag: LEAD_WS_METHODS.grant,
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:lead:revoke",
      tag: LEAD_WS_METHODS.revoke,
    }),
  };
}
