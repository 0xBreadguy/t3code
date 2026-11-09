import type { AgentRoleModelSelections, ModelSelection } from "@t3tools/contracts";
import type { LeadCapability } from "@t3tools/client-runtime/rpc/lead";
import type {
  LeadHandoff,
  LeadOwnershipAction,
  LeadOwnershipGrant,
  LeadReportedCheck,
  LeadThreadSummary,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";

export const LEAD_REVIEW_PENDING_TEXT =
  "Review the work handed back since I last looked. Summarize what each worker reported, " +
  "which checks are only reported rather than verified, and recommend what to combine. " +
  "Don't merge or open a PR unless I hand you ownership.";

export const LEAD_RECONCILE_TEXT =
  "Reconcile the work handed back for this project. Combine it on a separate branch and run " +
  "the checks. Don't open a PR or merge.";

export const LEAD_OWNERSHIP_ACTION_LABELS: Record<LeadOwnershipAction, string> = {
  reconcile: "combine and check work",
  open_pr: "open a pull request",
  merge: "merge",
};

export type LeadSheetStatusKind =
  | "needs-update"
  | "offline"
  | "writing"
  | "owns-project"
  | "owns-batch"
  | "reports"
  | "observing";

export interface LeadSheetStatus {
  readonly kind: LeadSheetStatusKind;
  readonly label: string;
}

/** One priority order for the sheet's status line; no invented activity. */
export function deriveLeadSheetStatus(input: {
  readonly capability: LeadCapability;
  readonly online: boolean;
  readonly running: boolean;
  readonly ownership: LeadOwnershipGrant | null;
  readonly reportsToReview: number;
}): LeadSheetStatus {
  if (input.capability.kind === "unsupported") {
    return { kind: "needs-update", label: "Needs update" };
  }
  if (!input.online) return { kind: "offline", label: "Offline" };
  if (input.running) return { kind: "writing", label: "Writing…" };
  const ownership = input.ownership;
  if (ownership !== null && ownership.revokedAt === null) {
    return ownership.scope.type === "project"
      ? { kind: "owns-project", label: "Owns project" }
      : { kind: "owns-batch", label: "Owns batch" };
  }
  if (input.reportsToReview > 0) {
    return { kind: "reports", label: "Reports to review" };
  }
  return { kind: "observing", label: "Observing" };
}

export interface LeadComposerAvailability {
  readonly canSend: boolean;
  /** Why sending is unavailable. An empty draft is disabled without a reason. */
  readonly reason: string | null;
}

export function leadComposerAvailability(input: {
  readonly capability: LeadCapability;
  readonly online: boolean;
  readonly environmentLabel: string;
  readonly canOperate: boolean;
  readonly text: string;
  readonly unreadableContextCount: number;
  readonly sending: boolean;
}): LeadComposerAvailability {
  const reason = ((): string | null => {
    if (input.capability.kind === "unsupported") return input.capability.reason;
    if (input.capability.kind === "offline" || !input.online) {
      return `Can't reach ${input.environmentLabel}. Your draft stays here.`;
    }
    if (!input.canOperate) return "You don't have permission to message this environment.";
    if (input.unreadableContextCount > 0) {
      return "Remove the context from another machine before sending.";
    }
    return null;
  })();
  const canSend = reason === null && input.text.trim().length > 0 && !input.sending;
  return { canSend, reason };
}

export function formatLeadThreadModel(thread: LeadThreadSummary | null): string | null {
  if (thread === null) return null;
  return `Runs as ${formatModelSlugName(thread.model)} · ${thread.providerInstanceId}`;
}

export function formatLeadRoleModel(selection: ModelSelection | undefined): string | null {
  return selection === undefined ? null : formatModelSlugName(selection.model);
}

export const LEAD_ROLE_UNSET_COPY =
  "No Lead role model set. Sending starts the lead with this project's default model. " +
  "Set the Lead role in Roles settings in the web or desktop app.";

/** What the sheet says about the model that will run the lead. */
export function leadModelSummary(input: {
  readonly thread: LeadThreadSummary | null;
  readonly roleModel: ModelSelection | undefined;
}): string {
  const threadLine = formatLeadThreadModel(input.thread);
  if (threadLine !== null) return threadLine;
  const roleLine = formatLeadRoleModel(input.roleModel);
  return roleLine === null ? LEAD_ROLE_UNSET_COPY : `Lead role · ${roleLine}`;
}

const LEAD_ROLE_ORDER = [
  "lead",
  "architecture",
  "implementation",
  "research",
  "review",
  "design",
  "test",
  "general",
] as const;

export function leadRoleRows(
  roleModels: AgentRoleModelSelections,
): ReadonlyArray<{ readonly role: string; readonly model: string }> {
  return LEAD_ROLE_ORDER.flatMap((role) => {
    const selection = roleModels[role];
    return selection === undefined ? [] : [{ role, model: formatModelSlugName(selection.model) }];
  });
}

export function formatReportedChecks(checks: ReadonlyArray<LeadReportedCheck>): string | null {
  if (checks.length === 0) return null;
  return checks.map((check) => `${check.name} ${check.outcome}`).join(" · ");
}

export function handoffHeadLabel(handoff: LeadHandoff): string {
  return handoff.head === null ? "No head reported" : `Head ${handoff.head.slice(0, 7)}`;
}

export function ownershipSummary(grant: LeadOwnershipGrant): string {
  const scope = grant.scope.type === "project" ? "this project" : "a worker batch";
  const actions = grant.actions.map((action) => LEAD_OWNERSHIP_ACTION_LABELS[action]).join(", ");
  return `Owns ${scope} · may ${actions}`;
}

export function isActiveGrant(grant: LeadOwnershipGrant | null): grant is LeadOwnershipGrant {
  return grant !== null && grant.revokedAt === null;
}
