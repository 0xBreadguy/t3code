import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  derivePendingThreadRequests,
  seedUserInputDraftAnswers,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  AuthOrchestrationOperateScope,
  type ProviderApprovalDecision,
  type RuntimeRequestId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useState } from "react";

import { derivePendingApprovals, derivePendingUserInputs } from "../../session-logic";
import { useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { ComposerPendingUserInputPanel } from "../chat/ComposerPendingUserInputPanel";
import { Button } from "../ui/button";

const EMPTY_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

/**
 * Real provider approvals and questions from the lead's own turn. They stay
 * pinned above the conversation and answer through the ordinary thread paths.
 */
export function LeadPending({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const projection = useQuietThreadProjection(threadRef);
  const threadCanOperate = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canOperate = threadRef !== null && threadCanOperate;
  const respondToApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const [responding, setResponding] = useState<ReadonlyArray<RuntimeRequestId>>([]);
  const [answers, setAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  if (threadRef === null || projection === null) return null;
  const pending = derivePendingThreadRequests(projection.projection);
  const approvals = derivePendingApprovals(pending.approvals);
  const userInputs = derivePendingUserInputs(pending.userInputs);
  const activeInput = userInputs[0] ?? null;
  const draftAnswers =
    activeInput === null
      ? EMPTY_ANSWERS
      : seedUserInputDraftAnswers(activeInput.questions, answers);

  const onApproval = async (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
    if (!canOperate) return;
    setResponding((current) => (current.includes(requestId) ? current : [...current, requestId]));
    try {
      const result = await respondToApproval({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, requestId, decision },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        throw new Error("Couldn't answer the lead's approval.");
      }
    } finally {
      setResponding((current) => current.filter((id) => id !== requestId));
    }
  };

  const onAdvance = () => {
    if (activeInput === null || !canOperate) return;
    const resolved = buildPendingUserInputAnswers(activeInput.questions, draftAnswers);
    if (questionIndex < activeInput.questions.length - 1) {
      setQuestionIndex((index) => index + 1);
      return;
    }
    if (resolved === null) return;
    const requestId = activeInput.requestId;
    setResponding((current) => (current.includes(requestId) ? current : [...current, requestId]));
    void respondToUserInput({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId, answers: resolved },
    }).finally(() => {
      setResponding((current) => current.filter((id) => id !== requestId));
    });
  };

  const onDismiss = (requestId: RuntimeRequestId) => {
    if (!canOperate) return;
    setResponding((current) => (current.includes(requestId) ? current : [...current, requestId]));
    void dismissUserInput({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId },
    }).finally(() => {
      setResponding((current) => current.filter((id) => id !== requestId));
    });
  };

  if (approvals.length === 0 && activeInput === null) return null;

  return (
    <div className="space-y-2 border-b border-border/70 px-3 py-2" data-lead-pending="">
      {approvals.map((approval) => (
        <div
          key={approval.requestId}
          className="rounded-md border border-warning/32 bg-warning/8 p-2"
        >
          <p className="text-sm font-medium text-warning-foreground">
            {approval.detail ?? approval.reason ?? "The lead needs your approval"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <ComposerPendingApprovalActions
              presentation="inline"
              requestId={approval.requestId}
              isResponding={responding.includes(approval.requestId)}
              canRespond={canOperate && approval.responseCapability === "live"}
              options={approval.options}
              onRespondToApproval={onApproval}
            />
          </div>
        </div>
      ))}
      {activeInput !== null ? (
        <div className="overflow-hidden rounded-md border border-border/70">
          <ComposerPendingUserInputPanel
            pendingUserInputs={userInputs}
            cwd={undefined}
            threadRef={threadRef}
            disabled={!canOperate}
            respondingRequestIds={[...responding]}
            answers={draftAnswers}
            questionIndex={questionIndex}
            onToggleOption={(questionId, optionValue) => {
              const question = activeInput.questions.find((entry) => entry.id === questionId);
              if (question === undefined) return;
              setAnswers((current) => ({
                ...current,
                [questionId]: togglePendingUserInputOptionSelection(
                  question,
                  draftAnswers[questionId],
                  optionValue,
                ),
              }));
            }}
            onAdvance={onAdvance}
            onDismiss={onDismiss}
          />
          {questionIndex < activeInput.questions.length - 1 ? (
            <div className="border-t border-border/70 px-2 py-1.5">
              <Button size="xs" variant="ghost" onClick={onAdvance}>
                Next question
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
