import { useAtomValue } from "@effect/atom-react";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  seedUserInputDraftAnswers,
  type ThreadUserInputQuestion,
} from "@t3tools/client-runtime/state/thread-requests";
import type {
  ProviderApprovalDecision,
  RuntimeRequestId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import type { PendingUserInput } from "../../lib/threadActivity";
import { leadEnvironment, leadErrorMessage, unwrapLeadResult } from "../../state/lead";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { PendingApprovalCard } from "../threads/PendingApprovalCard";
import { PendingUserInputCard } from "../threads/PendingUserInputCard";

const NO_PENDING_REQUESTS_ATOM = Atom.make<null>(null).pipe(
  Atom.withLabel("mobile-lead-pending:empty"),
);

/**
 * Real provider approvals and questions from the lead's own turn. They stay
 * pinned above the conversation and answer through the ordinary thread paths.
 */
export function LeadPending(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: ScopedThreadRef["environmentId"] | null;
  readonly online: boolean;
}) {
  const threadRef = props.threadRef;
  const pending = useAtomValue(
    threadRef === null
      ? NO_PENDING_REQUESTS_ATOM
      : environmentThreadDetails.pendingRequestsAtom(threadRef),
  );
  const canOperateEnvironment = useAtomValue(
    leadEnvironment.send.permissionAtom(props.environmentId),
  );
  const canOperate = props.online && canOperateEnvironment;
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const [respondingApprovalId, setRespondingApprovalId] = useState<RuntimeRequestId | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  if (threadRef === null || pending === null) return null;
  const approvals = pending.approvals;
  const activeInput = pending.userInputs[0] ?? null;
  if (approvals.length === 0 && activeInput === null) return null;

  const onRespondToApproval = async (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => {
    if (!canOperate) return;
    setRespondingApprovalId(requestId);
    setApprovalError(null);
    try {
      unwrapLeadResult(
        await respondToApproval({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, requestId, decision },
        }),
      );
    } catch (error) {
      setApprovalError(
        leadErrorMessage(error, "Couldn't send that decision. The request is still waiting."),
      );
    }
    setRespondingApprovalId((current) => (current === requestId ? null : current));
  };

  return (
    <View
      className="gap-2 border-b border-border bg-sheet px-4 py-3"
      accessibilityLabel="Lead requests"
    >
      {approvals.map((approval) => (
        <PendingApprovalCard
          key={approval.requestId}
          canOperateThread={canOperate}
          approval={approval}
          respondingApprovalId={respondingApprovalId}
          onRespond={onRespondToApproval}
        />
      ))}
      {approvalError !== null ? (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {approvalError}
        </Text>
      ) : null}
      {activeInput !== null ? (
        <LeadUserInput
          key={`${threadRef.environmentId}:${threadRef.threadId}:${activeInput.requestId}`}
          threadRef={threadRef}
          canOperate={canOperate}
          pendingUserInput={activeInput}
          remaining={pending.userInputs.length}
          onSubmit={async (requestId, answers) => {
            if (!canOperate) return;
            unwrapLeadResult(
              await respondToUserInput({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId, requestId, answers },
              }),
            );
          }}
          onDismiss={async (requestId) => {
            if (!canOperate) return;
            unwrapLeadResult(
              await dismissUserInput({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId, requestId },
              }),
            );
          }}
        />
      ) : null}
    </View>
  );
}

function LeadUserInput(props: {
  readonly threadRef: ScopedThreadRef;
  readonly canOperate: boolean;
  readonly pendingUserInput: PendingUserInput;
  readonly remaining: number;
  readonly onSubmit: (
    requestId: RuntimeRequestId,
    answers: Record<string, string | ReadonlyArray<string>>,
  ) => Promise<unknown>;
  readonly onDismiss: (requestId: RuntimeRequestId) => Promise<unknown>;
}) {
  const { height } = useWindowDimensions();
  const cardProgress = useSharedValue(1);
  const cardCoverage = useSharedValue(0);
  const maxHeight = useDerivedValue(() => Math.min(260, height * 0.28));
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seeded = seedUserInputDraftAnswers(props.pendingUserInput.questions, drafts);
  const answers = buildPendingUserInputAnswers(props.pendingUserInput.questions, seeded);

  const selectOption = (question: ThreadUserInputQuestion, value: string) => {
    setDrafts((current) => ({
      ...current,
      [question.id]: togglePendingUserInputOptionSelection(
        question,
        seedUserInputDraftAnswers([question], current)[question.id],
        value,
      ),
    }));
  };

  const changeCustomAnswer = (questionId: string, customAnswer: string) => {
    const question = props.pendingUserInput.questions.find((entry) => entry.id === questionId);
    if (question === undefined) return;
    setDrafts((current) => ({
      ...current,
      [questionId]: setPendingUserInputCustomAnswer(
        question,
        seedUserInputDraftAnswers([question], current)[questionId],
        customAnswer,
      ),
    }));
  };

  return (
    <View className="gap-1.5">
      <PendingUserInputCard
        environmentId={props.threadRef.environmentId}
        canOperateThread={props.canOperate}
        pendingUserInput={props.pendingUserInput}
        maxHeight={maxHeight}
        cardProgress={cardProgress}
        cardCoverage={cardCoverage}
        collapsed={false}
        collapsible={false}
        onToggleCollapsed={() => {}}
        threadTarget={props.threadRef}
        drafts={seeded}
        answers={answers}
        respondingUserInputId={responding ? props.pendingUserInput.requestId : null}
        onSelectOption={(requestId, question, value) => {
          if (requestId !== props.pendingUserInput.requestId) return;
          selectOption(question, value);
        }}
        onChangeCustomAnswer={(requestId, questionId, value) => {
          if (requestId !== props.pendingUserInput.requestId) return;
          changeCustomAnswer(questionId, value);
        }}
        onSubmit={async () => {
          if (answers === null || !props.canOperate) return;
          setResponding(true);
          setError(null);
          try {
            await props.onSubmit(props.pendingUserInput.requestId, answers);
          } catch (submitError) {
            setError(
              leadErrorMessage(
                submitError,
                "Couldn't send the answers. The question is still waiting.",
              ),
            );
          }
          setResponding(false);
        }}
        onDismiss={async () => {
          if (!props.canOperate) return;
          setError(null);
          try {
            await props.onDismiss(props.pendingUserInput.requestId);
          } catch (dismissError) {
            setError(
              leadErrorMessage(dismissError, "Couldn't dismiss the question. It is still waiting."),
            );
          }
        }}
      />
      {error !== null ? (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {props.remaining > 1 ? (
        <Text className="text-xs text-foreground-muted">
          {props.remaining} questions waiting. Answering this one shows the next.
        </Text>
      ) : null}
    </View>
  );
}
