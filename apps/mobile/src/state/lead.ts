import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createLeadCommands } from "@t3tools/client-runtime/state/lead-commands";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Typed `lead.*` commands. Components and hooks use these; no surface names a
 * raw RPC method string.
 */
export const leadEnvironment = createLeadCommands(connectionAtomRuntime);

/** Resolves a command result or throws the failure the UI should show. */
export function unwrapLeadResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

export function leadErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { readonly message: unknown }).message)
        : "";
  return message.trim().length > 0 ? message : fallback;
}
