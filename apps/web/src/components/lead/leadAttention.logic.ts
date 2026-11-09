import type {
  EnvironmentId,
  OrchestrationV2PendingRuntimeRequestSummary,
  OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

type LeadPendingRequest = Pick<OrchestrationV2PendingRuntimeRequestSummary, "kind" | "blocking">;

export interface LeadAttentionShell {
  readonly status: OrchestrationV2ThreadShell["status"];
  readonly pendingRuntimeRequest: LeadPendingRequest | null;
  readonly archivedAt: OrchestrationV2ThreadShell["archivedAt"];
}

export type LeadAttentionRequestKind = "approval" | "user_input";

export interface LeadAttentionInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly shell: LeadAttentionShell | null;
}

export interface LeadAttentionLead {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly needsYou: boolean;
  readonly requestKind: LeadAttentionRequestKind | null;
}

// Matches the runtime-is-working rule thread lists already use: a non-blocking
// question outlives the run, but only once the run has stopped working.
const WORKING_STATUSES: ReadonlySet<OrchestrationV2ThreadShell["status"]> = new Set([
  "preparing",
  "starting",
  "running",
]);

function requestKindOf(request: LeadPendingRequest | null): LeadAttentionRequestKind | null {
  if (request === null || request.kind === "auth_refresh") return null;
  return request.kind === "user_input" ? "user_input" : "approval";
}

/** One thread summary is one need; it is never a count of decisions inside that turn. */
export function pendingRequestNeedsUser(
  request: LeadPendingRequest | null,
  threadStatus: OrchestrationV2ThreadShell["status"],
): boolean {
  if (request === null || request.kind === "auth_refresh") return false;
  if (request.kind !== "user_input") return true;
  return request.blocking !== false || !WORKING_STATUSES.has(threadStatus);
}

export function deriveLeadAttention(
  inputs: ReadonlyArray<LeadAttentionInput>,
): ReadonlyArray<LeadAttentionLead> {
  return inputs.map((input) => {
    const shell = input.shell;
    const live = shell !== null && shell.archivedAt === null;
    return {
      environmentId: input.environmentId,
      projectId: input.projectId,
      threadId: input.threadId,
      needsYou: live && pendingRequestNeedsUser(shell.pendingRuntimeRequest, shell.status),
      requestKind: live ? requestKindOf(shell.pendingRuntimeRequest) : null,
    };
  });
}

export function countLeadsNeedingYou(
  attention: ReadonlyArray<Pick<LeadAttentionLead, "needsYou">>,
): number {
  return attention.reduce((count, lead) => (lead.needsYou ? count + 1 : count), 0);
}

/** Project-menu keys for the leads that still wait on the user. */
export function leadsNeedingYouScopes(
  attention: ReadonlyArray<LeadAttentionLead>,
): ReadonlySet<string> {
  return new Set(
    attention.filter((lead) => lead.needsYou).map((lead) => leadAttentionScopeKey(lead)),
  );
}

export function leadAttentionScopeKey(
  lead: Pick<LeadAttentionLead, "environmentId" | "projectId">,
) {
  return JSON.stringify([lead.environmentId, lead.projectId]);
}

export function leadButtonLabelWithAttention(
  baseLabel: string,
  attention: ReadonlyArray<Pick<LeadAttentionLead, "needsYou" | "requestKind">>,
): string {
  const waiting = attention.filter((lead) => lead.needsYou);
  if (waiting.length === 0) return baseLabel;
  if (waiting.length > 1) return `Lead, ${waiting.length} leads need you`;
  return waiting[0]?.requestKind === "user_input"
    ? "Lead, needs your answer"
    : "Lead, needs your approval";
}

export function sameLeadAttention(
  left: ReadonlyArray<LeadAttentionLead>,
  right: ReadonlyArray<LeadAttentionLead>,
): boolean {
  return (
    left.length === right.length &&
    right.every((lead, index) => {
      const previous = left[index];
      return (
        previous !== undefined &&
        previous.environmentId === lead.environmentId &&
        previous.projectId === lead.projectId &&
        previous.threadId === lead.threadId &&
        previous.needsYou === lead.needsYou &&
        previous.requestKind === lead.requestKind
      );
    })
  );
}
