import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import {
  buildPendingUserInputAnswers,
  type PendingUserInputAnswer,
  type PendingUserInputDraftAnswer,
  type PendingUserInputQuestion,
} from "@t3tools/client-runtime/state/pending-user-input";
import { seedUserInputDraftAnswers } from "@t3tools/client-runtime/state/thread-requests";

export interface LeadPendingAnswers {
  readonly requestKey: string | null;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly questionIndex: number;
}

const EMPTY_DRAFTS: Record<string, PendingUserInputDraftAnswer> = {};

/** Environment, lead thread and runtime request: one key, so no answer crosses them. */
export function leadPendingRequestKey(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: RuntimeRequestId,
): string {
  return JSON.stringify([environmentId, threadId, requestId]);
}

export function emptyLeadPendingAnswers(requestKey: string | null): LeadPendingAnswers {
  return { requestKey, drafts: EMPTY_DRAFTS, questionIndex: 0 };
}

/** Keeps drafts only while the same request is still pending. */
export function leadPendingAnswersFor(
  current: LeadPendingAnswers,
  requestKey: string | null,
): LeadPendingAnswers {
  return current.requestKey === requestKey ? current : emptyLeadPendingAnswers(requestKey);
}

export function withLeadPendingDraft(
  state: LeadPendingAnswers,
  questionId: string,
  draft: PendingUserInputDraftAnswer,
): LeadPendingAnswers {
  return { ...state, drafts: { ...state.drafts, [questionId]: draft } };
}

export function moveLeadPendingQuestion(
  state: LeadPendingAnswers,
  questionCount: number,
  direction: 1 | -1,
): LeadPendingAnswers {
  if (questionCount === 0) return state;
  const questionIndex = Math.max(0, Math.min(state.questionIndex + direction, questionCount - 1));
  return questionIndex === state.questionIndex ? state : { ...state, questionIndex };
}

/** Suggested answers show until the user edits them; only edits live in the state. */
export function leadPendingDrafts(
  questions: ReadonlyArray<PendingUserInputQuestion>,
  state: LeadPendingAnswers,
): Record<string, PendingUserInputDraftAnswer> {
  return seedUserInputDraftAnswers(questions, state.drafts);
}

/** Exact offered values and typed answers, or null while any question is unanswered. */
export function leadPendingAnswersToSubmit(
  questions: ReadonlyArray<PendingUserInputQuestion>,
  state: LeadPendingAnswers,
): Record<string, PendingUserInputAnswer> | null {
  return buildPendingUserInputAnswers(questions, leadPendingDrafts(questions, state));
}
