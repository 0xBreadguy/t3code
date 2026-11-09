import {
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  AuthOrchestrationOperateScope,
  type ProviderApprovalDecision,
  type RuntimeRequestId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { derivePendingUserInputProgress } from "../../pendingUserInput";
import { derivePendingApprovals, derivePendingUserInputs } from "../../session-logic";
import { useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { ComposerPendingUserInputPanel } from "../chat/ComposerPendingUserInputPanel";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  emptyLeadPendingAnswers,
  leadPendingAnswersFor,
  leadPendingAnswersToSubmit,
  leadPendingDrafts,
  leadPendingRequestKey,
  moveLeadPendingQuestion,
  withLeadPendingDraft,
} from "./leadPending.logic";

const EMPTY_DRAFTS: Record<string, PendingUserInputDraftAnswer> = {};
const NO_PENDING_REQUESTS = { approvals: [], userInputs: [] } as const;
const NO_PENDING_APPROVALS: ReturnType<typeof derivePendingApprovals> = [];
const NO_PENDING_USER_INPUTS: ReturnType<typeof derivePendingUserInputs> = [];

interface LeadPendingError {
  readonly key: string;
  readonly message: string;
}

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
  const [error, setError] = useState<LeadPendingError | null>(null);
  const inFlight = useRef(new Set<string>());

  const pending =
    projection === null ? NO_PENDING_REQUESTS : derivePendingThreadRequests(projection.projection);
  const approvals =
    projection === null || pending.approvals.length === 0
      ? NO_PENDING_APPROVALS
      : derivePendingApprovals(pending.approvals);
  const userInputs =
    projection === null || pending.userInputs.length === 0
      ? NO_PENDING_USER_INPUTS
      : derivePendingUserInputs(pending.userInputs);
  const activeInput = userInputs[0] ?? null;
  const requestKey =
    threadRef === null || activeInput === null
      ? null
      : leadPendingRequestKey(threadRef.environmentId, threadRef.threadId, activeInput.requestId);
  const [storedAnswers, setStoredAnswers] = useState(() => emptyLeadPendingAnswers(requestKey));
  // Drafts, question position and errors belong to one request only; a scope,
  // thread or request change starts clean rather than carrying them over.
  const answers = leadPendingAnswersFor(storedAnswers, requestKey);
  if (answers !== storedAnswers) setStoredAnswers(answers);
  const drafts =
    activeInput === null ? EMPTY_DRAFTS : leadPendingDrafts(activeInput.questions, answers);
  const progress =
    activeInput === null
      ? null
      : derivePendingUserInputProgress(activeInput.questions, drafts, answers.questionIndex);
  const activeQuestion = progress?.activeQuestion ?? null;
  const canAnswerInput =
    activeInput !== null && canOperate && activeInput.responseCapability !== "not_resumable";
  const inputBusy = activeInput !== null && responding.includes(activeInput.requestId);

  const sendRequest = async <R extends AtomCommandResult<unknown, unknown>>(
    requestId: RuntimeRequestId,
    fallback: string,
    action: () => Promise<R>,
  ) => {
    if (threadRef === null) return;
    const key = leadPendingRequestKey(threadRef.environmentId, threadRef.threadId, requestId);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setResponding((current) => (current.includes(requestId) ? current : [...current, requestId]));
    const result = await action();
    const interrupted = isAtomCommandInterrupted(result);
    if (result._tag === "Failure" && !interrupted) {
      const failure = squashAtomCommandFailure(result);
      setError({
        key,
        message:
          failure instanceof Error && failure.message.trim().length > 0
            ? failure.message
            : fallback,
      });
    } else if (!interrupted) {
      setError((current) => (current?.key === key ? null : current));
    }
    inFlight.current.delete(key);
    setResponding((current) => current.filter((id) => id !== requestId));
  };

  const onApproval = (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
    if (threadRef === null || !canOperate) return Promise.resolve();
    return sendRequest(requestId, "Couldn't send that approval decision.", () =>
      respondToApproval({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, requestId, decision },
      }),
    );
  };

  const onToggleOption = (questionId: string, optionValue: string) => {
    if (activeInput === null) return;
    const question = activeInput.questions.find((entry) => entry.id === questionId);
    if (question === undefined) return;
    setStoredAnswers((current) => {
      const currentAnswers = leadPendingAnswersFor(current, requestKey);
      return withLeadPendingDraft(
        currentAnswers,
        questionId,
        togglePendingUserInputOptionSelection(
          question,
          currentAnswers.drafts[questionId],
          optionValue,
        ),
      );
    });
  };

  const onCustomAnswer = (questionId: string, value: string) => {
    if (activeInput === null) return;
    const question = activeInput.questions.find((entry) => entry.id === questionId);
    if (question === undefined) return;
    setStoredAnswers((current) => {
      const currentAnswers = leadPendingAnswersFor(current, requestKey);
      return withLeadPendingDraft(
        currentAnswers,
        questionId,
        setPendingUserInputCustomAnswer(question, currentAnswers.drafts[questionId], value),
      );
    });
  };

  const moveQuestion = (direction: 1 | -1) => {
    if (activeInput === null) return;
    setStoredAnswers((current) =>
      moveLeadPendingQuestion(
        leadPendingAnswersFor(current, requestKey),
        activeInput.questions.length,
        direction,
      ),
    );
  };

  const submitAnswers = () => {
    if (threadRef === null || activeInput === null || !canOperate) return;
    if (activeInput.responseCapability === "not_resumable") return;
    const submitted = leadPendingAnswersToSubmit(activeInput.questions, answers);
    if (submitted === null) return;
    void sendRequest(activeInput.requestId, "Couldn't submit those answers.", () =>
      respondToUserInput({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          requestId: activeInput.requestId,
          answers: submitted,
        },
      }),
    );
  };

  const onAdvance = () => {
    if (activeInput === null || !canOperate) return;
    if (progress !== null && !progress.isLastQuestion) {
      if (progress.canAdvance) moveQuestion(1);
      return;
    }
    submitAnswers();
  };

  const onDismiss = (requestId: RuntimeRequestId) => {
    if (threadRef === null || !canOperate) return;
    void sendRequest(requestId, "Couldn't dismiss the question.", () =>
      dismissUserInput({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, requestId },
      }),
    );
  };

  if (threadRef === null || projection === null) return null;
  if (approvals.length === 0 && activeInput === null) return null;

  return (
    <div className="space-y-2 border-b border-border/70 px-3 py-2" data-lead-pending="">
      {approvals.map((approval) => {
        const approvalKey = leadPendingRequestKey(
          threadRef.environmentId,
          threadRef.threadId,
          approval.requestId,
        );
        return (
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
            {error?.key === approvalKey ? (
              <p className="mt-1 text-2xs text-destructive-foreground">{error.message}</p>
            ) : null}
          </div>
        );
      })}
      {activeInput !== null && activeQuestion !== null ? (
        <div className="overflow-hidden rounded-md border border-border/70">
          <ComposerPendingUserInputPanel
            pendingUserInputs={userInputs}
            cwd={undefined}
            threadRef={threadRef}
            disabled={!canOperate}
            respondingRequestIds={[...responding]}
            answers={drafts}
            questionIndex={answers.questionIndex}
            onToggleOption={onToggleOption}
            onAdvance={onAdvance}
            onDismiss={onDismiss}
          />
          {activeQuestion.allowCustomAnswer !== false ? (
            <div className="border-t border-border/70 px-2 py-1.5">
              <Textarea
                value={drafts[activeQuestion.id]?.customAnswer ?? ""}
                onChange={(event) => onCustomAnswer(activeQuestion.id, event.target.value)}
                rows={2}
                size="sm"
                disabled={!canAnswerInput || inputBusy}
                aria-label={`Your answer to: ${activeQuestion.header}`}
                placeholder="Type your answer"
              />
              <p className="mt-1 text-3xs text-muted-foreground">
                Text only. Files can't be attached in the lead panel.
              </p>
            </div>
          ) : null}
          {activeQuestion.options.length === 0 && activeQuestion.allowCustomAnswer === false ? (
            <p className="border-t border-border/70 px-2 py-1.5 text-2xs text-muted-foreground">
              This question has no answer options and doesn't accept a typed answer.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-2 py-1.5">
            {answers.questionIndex > 0 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={inputBusy}
                onClick={() => moveQuestion(-1)}
              >
                Back
              </Button>
            ) : null}
            <span className="ms-auto" />
            {progress?.isLastQuestion === true ? (
              <Button
                size="xs"
                disabled={!canAnswerInput || inputBusy || !progress.isComplete}
                onClick={onAdvance}
              >
                {activeInput.questions.length > 1 ? "Submit answers" : "Submit answer"}
              </Button>
            ) : (
              <Button
                size="xs"
                disabled={!canAnswerInput || inputBusy || progress?.canAdvance !== true}
                onClick={onAdvance}
              >
                Next question
              </Button>
            )}
          </div>
          {error !== null && error.key === requestKey ? (
            <p className="border-t border-border/70 px-2 py-1.5 text-2xs text-destructive-foreground">
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
