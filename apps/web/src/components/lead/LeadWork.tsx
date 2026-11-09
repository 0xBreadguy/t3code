import { CommandId } from "@t3tools/contracts";
import type {
  LeadAuthorityResult,
  LeadHandoff,
  LeadOwnershipAction,
  LeadReadResult,
} from "@t3tools/client-runtime/rpc/lead";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { useState } from "react";

import { newMessageId, randomUUID } from "../../lib/utils";
import { useLeadBackend } from "../../rpc/lead";
import { useThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";

const ACTION_LABELS: Record<LeadOwnershipAction, string> = {
  reconcile: "combine and check work",
  open_pr: "open a pull request",
  merge: "merge",
};

const REVIEW_PENDING_TEXT =
  "Review the work handed back since I last looked. Summarize what each worker reported, " +
  "which checks are only reported rather than verified, and recommend what to combine. " +
  "Don't merge or open a PR unless I hand you ownership.";

const RECONCILE_TEXT =
  "Reconcile the work handed back for this project. Combine it on a separate branch and run " +
  "the checks. Don't open a PR or merge.";

function LeadHandoffReport({
  handoff,
  environmentId,
}: {
  readonly handoff: LeadHandoff;
  readonly environmentId: LeadScope["environmentId"];
}) {
  const shell = useThreadShell({
    environmentId,
    threadId: handoff.sourceThreadId,
  });
  const checks = handoff.checks.map((check) => `${check.name} ${check.outcome}`).join(" · ");
  return (
    <div className="rounded-md border border-border/60 px-2 py-1.5" data-lead-handoff="">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {shell?.title?.trim() || "Worker report"}
        </span>
        <span className="shrink-0 text-3xs text-muted-foreground">Review required</span>
      </div>
      <p className="mt-0.5 line-clamp-3 text-2xs text-muted-foreground">{handoff.summary}</p>
      {checks.length > 0 ? (
        <p className="mt-0.5 truncate text-3xs text-muted-foreground">Reports: {checks}</p>
      ) : (
        <p className="mt-0.5 text-3xs text-muted-foreground">No checks reported.</p>
      )}
      <p className="mt-0.5 text-3xs text-muted-foreground/70">
        {handoff.head === null ? "No head reported" : `Head ${handoff.head.slice(0, 7)}`} · not
        merged · review required
      </p>
    </div>
  );
}

/**
 * Durable handoff and ownership records. A grant needs this explicit user
 * action; nothing here is minted from worker or lead output.
 */
export function LeadWork({
  scope,
  data,
  capabilityReason,
  canOperate,
  projectLabel,
  onChanged,
}: {
  readonly scope: LeadScope;
  readonly data: LeadReadResult | null;
  readonly capabilityReason: string | null;
  readonly canOperate: boolean;
  readonly projectLabel: string;
  readonly onChanged: () => void;
}) {
  const backend = useLeadBackend();
  const [grantOpen, setGrantOpen] = useState(false);
  const [actions, setActions] = useState<ReadonlyArray<LeadOwnershipAction>>(["reconcile"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingHandoffs = data?.pendingHandoffCount ?? 0;
  const ownership = data?.state?.ownership ?? null;
  const activeGrant = ownership !== null && ownership.revokedAt === null ? ownership : null;
  const revision = data?.state?.revision ?? 0;
  const disabled = capabilityReason !== null || !canOperate || busy;

  const run = async (action: () => Promise<LeadAuthorityResult | void>) => {
    setBusy(true);
    setError(null);
    const failure = await action()
      .then(() => null)
      .catch((actionError: unknown) =>
        actionError instanceof Error ? actionError : new Error("That didn't work."),
      );
    if (failure === null) onChanged();
    else setError(failure.message);
    setBusy(false);
  };

  const reviewPending = () =>
    run(async () => {
      await backend.send(scope.environmentId, {
        projectId: scope.projectId,
        commandId: CommandId.make(randomUUID()),
        messageId: newMessageId(),
        text: REVIEW_PENDING_TEXT,
      });
    });

  const reconcile = () =>
    run(async () => {
      await backend.send(scope.environmentId, {
        projectId: scope.projectId,
        commandId: CommandId.make(randomUUID()),
        messageId: newMessageId(),
        text: RECONCILE_TEXT,
      });
    });

  const grant = () =>
    run(async () => {
      if (actions.length === 0) return;
      await backend.grant(scope.environmentId, {
        projectId: scope.projectId,
        expectedRevision: revision,
        scope: { type: "project" },
        actions,
      });
      setGrantOpen(false);
    });

  const takeBack = () =>
    run(async () => {
      if (activeGrant === null) return;
      await backend.revoke(scope.environmentId, {
        projectId: scope.projectId,
        expectedRevision: revision,
        grantId: activeGrant.id,
      });
    });

  if (data?.binding === null || data === null) return null;

  return (
    <div className="space-y-2 border-b border-border/70 px-3 py-2" data-lead-work="">
      {pendingHandoffs > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">
              {pendingHandoffs === 1
                ? "1 worker handed work back"
                : `${pendingHandoffs} workers handed work back`}
            </span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => void reviewPending()}
              >
                Review pending work
              </Button>
              <Button size="xs" disabled={disabled} onClick={() => void reconcile()}>
                Reconcile as recommended
              </Button>
            </div>
          </div>
          <p className="text-3xs text-muted-foreground">
            Reconcile combines on a separate branch and runs checks. It won't open a PR.
          </p>
        </>
      ) : null}

      {data?.state?.handoffs.slice(-3).map((handoff) => (
        <LeadHandoffReport key={handoff.id} handoff={handoff} environmentId={scope.environmentId} />
      ))}

      {activeGrant !== null ? (
        <div className="space-y-1.5 rounded-md border border-border/70 px-2 py-1.5">
          <p className="text-xs text-foreground">
            Owns {activeGrant.scope.type === "project" ? "this project" : "a worker batch"} · may{" "}
            {activeGrant.actions.map((action) => ACTION_LABELS[action]).join(", ")}
          </p>
          <p className="text-2xs text-muted-foreground">
            It won't change what providers may run without asking. Those permissions stay as they
            are.
          </p>
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => void takeBack()}>
            Take back
          </Button>
        </div>
      ) : grantOpen ? (
        <div className="space-y-2 rounded-md border border-border/70 px-2 py-1.5">
          <p className="text-xs text-foreground">The {projectLabel} lead will own this project.</p>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(ACTION_LABELS) as ReadonlyArray<LeadOwnershipAction>).map((action) => (
              <label key={action} className="flex items-center gap-1.5 text-2xs">
                <Checkbox
                  checked={actions.includes(action)}
                  onCheckedChange={(checked) =>
                    setActions((current) =>
                      checked === true
                        ? [...current, action]
                        : current.filter((entry) => entry !== action),
                    )
                  }
                />
                {ACTION_LABELS[action]}
              </label>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Ends when you take it back. A grant doesn't sandbox shell commands or undo earlier work.
          </p>
          <div className="flex gap-1.5">
            <Button
              size="xs"
              disabled={disabled || actions.length === 0}
              onClick={() => void grant()}
            >
              Hand over
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setGrantOpen(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setGrantOpen(true)}>
          Hand over authority…
        </Button>
      )}

      {error !== null ? <p className="text-2xs text-destructive-foreground">{error}</p> : null}
    </div>
  );
}
