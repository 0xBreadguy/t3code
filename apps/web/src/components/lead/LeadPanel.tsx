import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { LeadContinuity, LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import { useQuietThreadProjection, useProject } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { LeadComposer } from "./LeadComposer";
import { LeadContinuityBar } from "./LeadContinuityBar";
import { LeadConversation } from "./LeadConversation";
import { LeadHeader } from "./LeadHeader";
import { LeadPending } from "./LeadPending";
import { LeadWork } from "./LeadWork";
import type { LeadPage } from "./useLeadPage";
import type { LeadSessionState } from "./useLeadSession";

const RUNNING_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

function useLeadRunning(scope: LeadScope, data: LeadReadResult | null): boolean {
  const threadRef =
    data?.thread === null || data?.thread === undefined
      ? null
      : { environmentId: scope.environmentId, threadId: data.thread.threadId };
  const projection = useQuietThreadProjection(threadRef);
  return projection?.projection.runs.some((run) => RUNNING_STATUSES.has(run.status)) ?? false;
}

function leadStatusLabel(input: {
  readonly capabilityReason: string | null;
  readonly online: boolean;
  readonly running: boolean;
  readonly ownershipActive: boolean;
  readonly ownershipScope: "project" | "threads" | null;
  readonly reportsToReview: number;
}): string {
  if (input.capabilityReason !== null) return "Needs update";
  if (!input.online) return "Offline";
  if (input.running) return "Writing…";
  if (input.ownershipActive) {
    return input.ownershipScope === "project" ? "Owns project" : "Owns batch";
  }
  if (input.reportsToReview > 0) return "Reports to review";
  return "Observing";
}

export function LeadPanel({
  scope,
  page,
  continuity,
  session,
  projectLabel,
  canOperate,
  expanded,
  onSwitch,
  onExpand,
  onClose,
  onChanged,
}: {
  readonly scope: LeadScope;
  readonly page: LeadPage;
  readonly continuity: LeadContinuity;
  readonly session: LeadSessionState;
  readonly projectLabel: string;
  readonly canOperate: boolean;
  readonly expanded: boolean;
  readonly onSwitch: (scope: LeadScope) => void;
  readonly onExpand: () => void;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const environment = useEnvironment(scope.environmentId);
  const project = useProject(scopeProjectRef(scope.environmentId, scope.projectId));
  const data = session.data;
  const running = useLeadRunning(scope, data);
  const capabilityReason =
    session.capability.kind === "unsupported"
      ? session.capability.reason
      : session.capability.kind === "offline"
        ? `${environment?.label ?? "This environment"} is offline.`
        : null;
  const ownership = data?.state?.ownership ?? null;
  const ownershipActive = ownership !== null && ownership.revokedAt === null;
  const status = leadStatusLabel({
    capabilityReason,
    online: session.online,
    running,
    ownershipActive,
    ownershipScope: ownership?.scope.type ?? null,
    reportsToReview: data?.pendingHandoffCount ?? 0,
  });
  const threadRef =
    data?.thread === null || data?.thread === undefined
      ? null
      : { environmentId: scope.environmentId, threadId: data.thread.threadId };
  const resolvedModel =
    data?.thread === undefined || data?.thread === null
      ? null
      : `${data.thread.model} · ${data.thread.providerInstanceId}`;
  const roleLine = resolvedModel === null ? null : `Runs as ${resolvedModel}`;

  return (
    <div
      id="lead-panel"
      role="dialog"
      aria-label={`${projectLabel} lead`}
      aria-modal="false"
      className="flex min-h-0 flex-col"
      data-lead-panel=""
    >
      <LeadHeader
        scope={scope}
        projectLabel={projectLabel}
        status={status}
        expanded={expanded}
        onSwitch={onSwitch}
        onExpand={onExpand}
        onClose={onClose}
      />
      {capabilityReason !== null ? (
        <p className="border-b border-border/70 bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground">
          {capabilityReason} Your draft stays here.
        </p>
      ) : null}
      {session.error !== null ? (
        <p className="border-b border-border/70 bg-destructive/8 px-3 py-1.5 text-2xs text-destructive-foreground">
          {session.error}
        </p>
      ) : null}
      <LeadContinuityBar continuity={continuity} scope={scope} onSwitch={onSwitch} />
      {data === null && capabilityReason === null ? (
        <p className="px-3 py-2 text-2xs text-muted-foreground">Reading this project's lead…</p>
      ) : null}
      <LeadPending threadRef={threadRef} />
      <LeadWork
        scope={scope}
        data={data}
        capabilityReason={capabilityReason}
        canOperate={canOperate}
        projectLabel={project?.title ?? projectLabel}
        onChanged={onChanged}
      />
      <LeadConversation
        threadRef={threadRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        emptyCopy={
          data === null || data.binding === null
            ? `Ask about work in ${projectLabel}. The lead watches what workers hand back. ` +
              "It won't merge, open PRs or change code unless you hand it ownership."
            : data.state == null || data.state.handoffs.length === 0
              ? "Nothing handed back yet. Workers report here when they finish."
              : "Ask the lead what to do next."
        }
      />
      {roleLine !== null ? (
        <p className="border-t border-border/70 px-3 py-1 text-3xs text-muted-foreground">
          {roleLine}
        </p>
      ) : null}
      <LeadComposer
        scope={scope}
        page={page}
        data={data}
        capabilityReason={capabilityReason}
        running={running}
        projectLabel={projectLabel}
        contextEnabled={session.capability.kind === "supported" && session.capability.contextRefs}
        onSent={onChanged}
      />
    </div>
  );
}
