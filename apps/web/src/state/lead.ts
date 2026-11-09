import { createLeadCommands } from "@t3tools/client-runtime/state/lead-commands";

import { connectionAtomRuntime } from "../connection/runtime";

export const leadEnvironment = createLeadCommands(connectionAtomRuntime);
