import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
  ProjectId,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * Roles an agent or project lead may route to a model. `lead` and `architecture`
 * are planning roles; the rest existed as `delegate_task` roles.
 */
export const AgentRole = Schema.Literals([
  "lead",
  "architecture",
  "implementation",
  "research",
  "review",
  "design",
  "test",
  "general",
]);
export type AgentRole = typeof AgentRole.Type;

const AgentRoleKeys = {
  lead: Schema.optionalKey(ModelSelection),
  architecture: Schema.optionalKey(ModelSelection),
  implementation: Schema.optionalKey(ModelSelection),
  research: Schema.optionalKey(ModelSelection),
  review: Schema.optionalKey(ModelSelection),
  design: Schema.optionalKey(ModelSelection),
  test: Schema.optionalKey(ModelSelection),
  general: Schema.optionalKey(ModelSelection),
} as const;

/** Sparse by design: an absent role inherits the next scope. Unknown role keys round-trip. */
export const AgentRoleModelSelections = Schema.StructWithRest(Schema.Struct(AgentRoleKeys), [
  Schema.Record(Schema.String, Schema.Unknown),
]);
export type AgentRoleModelSelections = typeof AgentRoleModelSelections.Type;

export const AgentRoleModelSelectionPatch = Schema.Struct({
  lead: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  architecture: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  implementation: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  research: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  review: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  design: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  test: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  general: Schema.optionalKey(Schema.NullOr(ModelSelection)),
});
export type AgentRoleModelSelectionPatch = typeof AgentRoleModelSelectionPatch.Type;

export const ProjectLeadWorkerFinish = Schema.Literals(["handoff", "independent"]);
export type ProjectLeadWorkerFinish = typeof ProjectLeadWorkerFinish.Type;

/** Environment-owned binding of one project to its ordinary lead thread. */
export const ProjectLeadConfig = Schema.Struct({
  threadId: ThreadId,
  workerDefault: ProjectLeadWorkerFinish,
  /** Explicit per-worker user override; absent workers use `workerDefault`. */
  workerFinishOverrides: Schema.Record(ThreadId, ProjectLeadWorkerFinish).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ProjectLeadConfig = typeof ProjectLeadConfig.Type;

export const ProjectLeadConfigPatch = Schema.Struct({
  /** null removes the binding without touching role models or worker policy of other projects. */
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  workerDefault: Schema.optionalKey(ProjectLeadWorkerFinish),
  workerFinishOverrides: Schema.optionalKey(
    Schema.Record(ThreadId, Schema.NullOr(ProjectLeadWorkerFinish)),
  ),
});
export type ProjectLeadConfigPatch = typeof ProjectLeadConfigPatch.Type;

export const LeadModelPolicySource = Schema.Literals([
  "explicit",
  "project_role",
  "environment_role",
  "thread_inheritance",
]);
export type LeadModelPolicySource = typeof LeadModelPolicySource.Type;

export const LeadModelResolution = Schema.Struct({
  modelSelection: ModelSelection,
  source: LeadModelPolicySource,
});
export type LeadModelResolution = typeof LeadModelResolution.Type;

export const LeadReportedCheckOutcome = Schema.Literals(["passed", "failed", "skipped", "unknown"]);
export type LeadReportedCheckOutcome = typeof LeadReportedCheckOutcome.Type;

/** Exactly what the worker said it ran. T3 never upgrades this to "verified". */
export const LeadReportedCheck = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  outcome: LeadReportedCheckOutcome,
  command: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  detail: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
});
export type LeadReportedCheck = typeof LeadReportedCheck.Type;

export const LeadHandoffReviewStatus = Schema.Literal("review_required");
export type LeadHandoffReviewStatus = typeof LeadHandoffReviewStatus.Type;

export const LeadHandoff = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceThreadId: ThreadId,
  sourceRunId: RunId,
  /** Immutable Git head when T3 could resolve one, else the worker's reported head. */
  head: Schema.NullOr(TrimmedNonEmptyString),
  headSource: Schema.NullOr(Schema.Literals(["resolved", "reported"])),
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)),
  checks: Schema.Array(LeadReportedCheck).check(Schema.isMaxLength(20)),
  reviewStatus: LeadHandoffReviewStatus,
  /** A normal turn ending is not a handoff; only an explicit record is. */
  status: Schema.Literal("reported"),
  createdAt: IsoDateTime,
});
export type LeadHandoff = typeof LeadHandoff.Type;

export const LeadOwnershipAction = Schema.Literals(["reconcile", "open_pr", "merge"]);
export type LeadOwnershipAction = typeof LeadOwnershipAction.Type;

export const LeadOwnershipScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("project") }),
  Schema.Struct({
    type: Schema.Literal("threads"),
    threadIds: Schema.Array(ThreadId).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
]);
export type LeadOwnershipScope = typeof LeadOwnershipScope.Type;

/** Grant, end, and revoke are distinct; nothing here reverts earlier work or sandboxes a shell. */
export const LeadOwnershipGrant = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: LeadOwnershipScope,
  actions: Schema.Array(LeadOwnershipAction).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  grantedAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type LeadOwnershipGrant = typeof LeadOwnershipGrant.Type;

export const LeadState = Schema.Struct({
  revision: NonNegativeInt,
  handoffs: Schema.Array(LeadHandoff).check(Schema.isMaxLength(100)),
  ownership: Schema.NullOr(LeadOwnershipGrant).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type LeadState = typeof LeadState.Type;

export type LeadStateRevisionProblem = "stale_revision" | "non_monotonic_revision";

/** The pure compare-and-swap rule the decider and service both rely on. */
export function leadStateRevisionProblem(input: {
  readonly currentRevision: number | undefined;
  readonly expectedRevision: number | undefined;
  readonly nextRevision: number | undefined;
}): LeadStateRevisionProblem | null {
  const current = input.currentRevision ?? 0;
  if (input.expectedRevision !== current) return "stale_revision";
  if (input.nextRevision !== undefined && input.nextRevision !== current + 1) {
    return "non_monotonic_revision";
  }
  return null;
}

export const LeadBindingStatus = Schema.Literals([
  "ok",
  "missing_thread",
  "wrong_project",
  "archived",
]);
export type LeadBindingStatus = typeof LeadBindingStatus.Type;

export const LeadThreadSummary = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  providerInstanceId: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  archived: Schema.Boolean,
  active: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type LeadThreadSummary = typeof LeadThreadSummary.Type;

export const LeadEnsureInput = Schema.Struct({
  projectId: ProjectId,
  /** Retrying with the same value targets the same lead launch and binding. */
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  existingThreadId: Schema.optional(ThreadId),
  modelSelection: Schema.optional(ModelSelection),
});
export type LeadEnsureInput = typeof LeadEnsureInput.Type;

export const LeadEnsureResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  created: Schema.Boolean,
  modelSelection: ModelSelection,
  policySource: LeadModelPolicySource,
  binding: ProjectLeadConfig,
  thread: LeadThreadSummary,
});
export type LeadEnsureResult = typeof LeadEnsureResult.Type;

export const LeadReadInput = Schema.Struct({
  projectId: ProjectId,
});
export type LeadReadInput = typeof LeadReadInput.Type;

export const LeadReadResult = Schema.Struct({
  projectId: ProjectId,
  binding: Schema.NullOr(ProjectLeadConfig),
  bindingStatus: LeadBindingStatus,
  thread: Schema.NullOr(LeadThreadSummary),
  state: Schema.NullOr(LeadState),
  pendingHandoffCount: NonNegativeInt,
  workerDefault: ProjectLeadWorkerFinish,
  roleModels: AgentRoleModelSelections,
});
export type LeadReadResult = typeof LeadReadResult.Type;

export const LeadSendMode = Schema.Literals(["auto", "queue", "steer", "restart"]);
export type LeadSendMode = typeof LeadSendMode.Type;

export const LeadSendInput = Schema.Struct({
  projectId: ProjectId,
  /** All ids are required so a retry is idempotent and never starts a second turn. */
  commandId: CommandId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)),
  mode: Schema.optional(LeadSendMode),
});
export type LeadSendInput = typeof LeadSendInput.Type;

export const LeadSendResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  commandId: CommandId,
  messageId: MessageId,
  runId: RunId,
  sequence: NonNegativeInt,
  delivery: Schema.Literals(["started", "queued", "steered", "restarted"]),
});
export type LeadSendResult = typeof LeadSendResult.Type;

export const LeadConfigureInput = Schema.Struct({
  projectId: ProjectId,
  existingThreadId: Schema.optional(ThreadId),
  workerDefault: Schema.optional(ProjectLeadWorkerFinish),
  /** null clears the whole per-worker override map. */
  workerFinishOverrides: Schema.optional(
    Schema.NullOr(Schema.Record(ThreadId, Schema.NullOr(ProjectLeadWorkerFinish))),
  ),
  roleModels: Schema.optional(AgentRoleModelSelectionPatch),
  /** A project-scoped role override patch; null clears every project role override. */
  projectRoleModels: Schema.optional(Schema.NullOr(AgentRoleModelSelectionPatch)),
});
export type LeadConfigureInput = typeof LeadConfigureInput.Type;

export const LeadConfigureResult = Schema.Struct({
  projectId: ProjectId,
  binding: Schema.NullOr(ProjectLeadConfig),
  roleModels: AgentRoleModelSelections,
});
export type LeadConfigureResult = typeof LeadConfigureResult.Type;

export const LeadHandoffInput = Schema.Struct({
  /** Defaults to the calling thread. A caller may only report its own project's work. */
  sourceThreadId: Schema.optional(ThreadId),
  sourceRunId: Schema.optional(RunId),
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)),
  checks: Schema.Array(LeadReportedCheck).check(Schema.isMaxLength(20)),
  head: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type LeadHandoffInput = typeof LeadHandoffInput.Type;

export const LeadHandoffResult = Schema.Struct({
  projectId: ProjectId,
  leadThreadId: ThreadId,
  handoff: LeadHandoff,
  created: Schema.Boolean,
  revision: NonNegativeInt,
  pendingHandoffCount: NonNegativeInt,
});
export type LeadHandoffResult = typeof LeadHandoffResult.Type;

export const LeadStatusInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type LeadStatusInput = typeof LeadStatusInput.Type;

export const LeadStatusResult = Schema.Struct({
  projectId: ProjectId,
  binding: Schema.NullOr(ProjectLeadConfig),
  bindingStatus: LeadBindingStatus,
  workerDefault: ProjectLeadWorkerFinish,
  pendingHandoffs: Schema.Array(LeadHandoff).check(Schema.isMaxLength(100)),
  ownership: Schema.NullOr(LeadOwnershipGrant),
  revision: Schema.NullOr(NonNegativeInt),
});
export type LeadStatusResult = typeof LeadStatusResult.Type;

export const LeadGrantInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  scope: LeadOwnershipScope,
  actions: Schema.Array(LeadOwnershipAction).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
});
export type LeadGrantInput = typeof LeadGrantInput.Type;

export const LeadRevokeInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  grantId: TrimmedNonEmptyString,
});
export type LeadRevokeInput = typeof LeadRevokeInput.Type;

export const LeadAuthorityResult = Schema.Struct({
  projectId: ProjectId,
  leadThreadId: ThreadId,
  revision: NonNegativeInt,
  ownership: Schema.NullOr(LeadOwnershipGrant),
});
export type LeadAuthorityResult = typeof LeadAuthorityResult.Type;

/** Transport error. `reason` drives client behavior; `message` is fixed, user-facing text. */
export class LeadRpcError extends Schema.TaggedError<LeadRpcError>()("LeadRpcError", {
  operation: Schema.String.check(Schema.isMaxLength(64)),
  reason: Schema.Literals([
    "invalid_request",
    "project_not_found",
    "thread_not_found",
    "thread_archived",
    "wrong_project",
    "stale_revision",
    "model_unavailable",
    "provider_disabled",
    "ownership_missing",
    "orchestration_error",
  ]),
  message: Schema.String.check(Schema.isMaxLength(4_000)),
  projectId: Schema.optional(ProjectId),
  cause: Schema.optional(Schema.Defect()),
}) {}

export const LEAD_WS_METHODS = {
  ensure: "lead.ensure",
  read: "lead.read",
  send: "lead.send",
  configure: "lead.configure",
  grant: "lead.grant",
  revoke: "lead.revoke",
} as const;
