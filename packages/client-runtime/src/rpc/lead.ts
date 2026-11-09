import type {
  CommandId,
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

/**
 * Client view of the lead service defined in packages/contracts/src/lead.ts.
 * These mirror the wire fields T3 reads; primary replaces this module's types
 * with the contract imports when the backend commit lands in this worktree.
 * Components never call a transport or invent an RPC method name.
 */

export type LeadCapability =
  | { readonly kind: "supported" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "offline"; readonly since: string | null };

export type LeadModelPolicySource =
  | "explicit"
  | "project_role"
  | "environment_role"
  | "thread_inheritance";

export type LeadWorkerFinish = "handoff" | "independent";

export type LeadBindingStatus = "ok" | "missing_thread" | "wrong_project" | "archived";

export type LeadOwnershipAction = "reconcile" | "open_pr" | "merge";

export type LeadOwnershipScope =
  | { readonly type: "project" }
  | { readonly type: "threads"; readonly threadIds: ReadonlyArray<ThreadId> };

export type LeadReportedCheckOutcome = "passed" | "failed" | "skipped" | "unknown";

export interface LeadReportedCheck {
  readonly name: string;
  readonly outcome: LeadReportedCheckOutcome;
  readonly command?: string;
  readonly detail?: string;
}

export interface LeadHandoff {
  readonly id: string;
  readonly sourceThreadId: ThreadId;
  readonly sourceRunId: RunId;
  readonly head: string | null;
  readonly headSource: "resolved" | "reported" | null;
  readonly summary: string;
  readonly checks: ReadonlyArray<LeadReportedCheck>;
  readonly reviewStatus: "review_required";
  readonly status: "reported";
  readonly createdAt: string;
}

export interface LeadOwnershipGrant {
  readonly id: string;
  readonly scope: LeadOwnershipScope;
  readonly actions: ReadonlyArray<LeadOwnershipAction>;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

export interface LeadState {
  readonly revision: number;
  readonly handoffs: ReadonlyArray<LeadHandoff>;
  readonly ownership: LeadOwnershipGrant | null;
}

export interface ProjectLeadConfig {
  readonly threadId: ThreadId;
  readonly workerDefault: LeadWorkerFinish;
  readonly workerFinishOverrides: Readonly<Record<string, LeadWorkerFinish>>;
}

export interface LeadThreadSummary {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly archived: boolean;
  readonly active: boolean;
  readonly updatedAt: string;
}

export interface LeadEnsureInput {
  readonly projectId: ProjectId;
  readonly requestId: string;
  readonly existingThreadId?: ThreadId;
  readonly modelSelection?: ModelSelection;
}

export interface LeadEnsureResult {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly created: boolean;
  readonly modelSelection: ModelSelection;
  readonly policySource: LeadModelPolicySource;
  readonly binding: ProjectLeadConfig;
  readonly thread: LeadThreadSummary;
}

export interface LeadReadInput {
  readonly projectId: ProjectId;
}

export interface LeadReadResult {
  readonly projectId: ProjectId;
  readonly binding: ProjectLeadConfig | null;
  readonly bindingStatus: LeadBindingStatus;
  readonly thread: LeadThreadSummary | null;
  readonly state: LeadState | null;
  readonly pendingHandoffCount: number;
  readonly workerDefault: LeadWorkerFinish;
  readonly roleModels: Readonly<Record<string, ModelSelection>>;
}

export interface LeadSendInput {
  readonly projectId: ProjectId;
  readonly commandId: CommandId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly mode?: "auto" | "queue" | "steer" | "restart";
}

export interface LeadSendResult {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly sequence: number;
  readonly delivery: "started" | "queued" | "steered" | "restarted";
}

export interface LeadGrantInput {
  readonly projectId: ProjectId;
  readonly expectedRevision: number;
  readonly scope: LeadOwnershipScope;
  readonly actions: ReadonlyArray<LeadOwnershipAction>;
}

export interface LeadRevokeInput {
  readonly projectId: ProjectId;
  readonly expectedRevision: number;
  readonly grantId: string;
}

export interface LeadAuthorityResult {
  readonly projectId: ProjectId;
  readonly leadThreadId: ThreadId;
  readonly revision: number;
  readonly ownership: LeadOwnershipGrant | null;
}

/**
 * The typed transport primary supplies once the contract module is merged.
 * Each method maps to one `lead.*` WS method; this is the only layer allowed
 * to know the transport. Capability reads ServerConfig.projectLead.
 */
export interface LeadTransport {
  readonly capability: (environmentId: EnvironmentId) => LeadCapability;
  readonly ensure: (input: LeadEnsureInput) => Promise<LeadEnsureResult>;
  readonly read: (input: LeadReadInput) => Promise<LeadReadResult>;
  readonly send: (input: LeadSendInput) => Promise<LeadSendResult>;
  readonly grant: (input: LeadGrantInput) => Promise<LeadAuthorityResult>;
  readonly revoke: (input: LeadRevokeInput) => Promise<LeadAuthorityResult>;
}

export type LeadBackend = LeadTransport;

class LeadBackendError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "LeadBackendError";
    this.reason = reason;
  }
}

const unavailable: LeadCapability = {
  kind: "unsupported",
  reason: "This server needs an update to use the lead.",
};

const reject = (): Promise<never> =>
  Promise.reject(new LeadBackendError("unsupported", unavailable.reason));

/** Honest default until a server-backed transport is registered. */
export const unavailableLeadBackend: LeadBackend = {
  capability: () => unavailable,
  ensure: reject,
  read: reject,
  send: reject,
  grant: reject,
  revoke: reject,
};
