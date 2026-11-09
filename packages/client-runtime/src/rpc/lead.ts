import type {
  EnvironmentId,
  LeadAuthorityResult,
  LeadEnsureInput,
  LeadEnsureResult,
  LeadGrantInput,
  LeadHandoff,
  LeadOwnershipAction,
  LeadOwnershipScope,
  LeadReadInput,
  LeadReadResult,
  LeadReportedCheck,
  LeadRevokeInput,
  LeadSendInput,
  LeadSendResult,
  LeadState,
  LeadThreadSummary,
  ProjectLeadConfig,
} from "@t3tools/contracts";

export type {
  LeadAuthorityResult,
  LeadEnsureInput,
  LeadEnsureResult,
  LeadGrantInput,
  LeadHandoff,
  LeadOwnershipAction,
  LeadOwnershipScope,
  LeadReadInput,
  LeadReadResult,
  LeadReportedCheck,
  LeadRevokeInput,
  LeadSendInput,
  LeadSendResult,
  LeadState,
  LeadThreadSummary,
  ProjectLeadConfig,
};

/**
 * Capability is the only client-side gate. `contextRefs` follows the server's
 * optional LeadSendInput.context support; false keeps chips out of the message
 * rather than sending decorative ones.
 */
export type LeadCapability =
  | {
      readonly kind: "supported";
      readonly contextRefs: boolean;
    }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "offline"; readonly since: string | null };

/**
 * The transport layer primary registers. Each method maps to one `lead.*` WS
 * method; components never call a transport or know a method name.
 */
export interface LeadTransport {
  readonly capability: (environmentId: EnvironmentId) => LeadCapability;
  readonly ensure: (
    environmentId: EnvironmentId,
    input: LeadEnsureInput,
  ) => Promise<LeadEnsureResult>;
  readonly read: (environmentId: EnvironmentId, input: LeadReadInput) => Promise<LeadReadResult>;
  readonly send: (environmentId: EnvironmentId, input: LeadSendInput) => Promise<LeadSendResult>;
  readonly grant: (
    environmentId: EnvironmentId,
    input: LeadGrantInput,
  ) => Promise<LeadAuthorityResult>;
  readonly revoke: (
    environmentId: EnvironmentId,
    input: LeadRevokeInput,
  ) => Promise<LeadAuthorityResult>;
}

/** Alias kept for call sites that distinguish a send request from its result. */
export type LeadSendRequest = LeadSendInput;

export type LeadBackend = LeadTransport;
