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
  OrchestrationMessageContext,
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
 * Capability is the only client-side gate. `contextRefs` stays false until the
 * server accepts LeadSendInput.context; the composer then says the message is
 * text-only instead of pretending a chip was sent.
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

/** Forward-compatible with the pending optional context field on lead.send. */
export interface LeadSendRequest extends LeadSendInput {
  readonly context?: OrchestrationMessageContext;
}

export type LeadBackend = LeadTransport;
