import {
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputQuestion,
} from "@t3tools/client-runtime/state/pending-user-input";
import { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  emptyLeadPendingAnswers,
  leadPendingAnswersFor,
  leadPendingAnswersToSubmit,
  leadPendingDrafts,
  leadPendingRequestKey,
  moveLeadPendingQuestion,
  withLeadPendingDraft,
} from "./leadPending.logic";

const multiQuestion = {
  id: "files",
  options: [
    { value: "src/a.ts", label: "A" },
    { value: "src/b.ts", label: "B" },
  ],
  multiSelect: true,
} satisfies PendingUserInputQuestion;

const freeTextQuestion = {
  id: "note",
  options: [],
  allowCustomAnswer: true,
} satisfies PendingUserInputQuestion;

const suggestedQuestion = {
  id: "summary",
  options: [{ label: "Ship" }],
  initialAnswer: "  Draft text  ",
} satisfies PendingUserInputQuestion;

describe("leadPendingRequestKey", () => {
  it("includes the environment, lead thread and request", () => {
    const key = leadPendingRequestKey(
      EnvironmentId.make("environment"),
      ThreadId.make("thread"),
      RuntimeRequestId.make("request"),
    );
    expect(key).not.toBe(
      leadPendingRequestKey(
        EnvironmentId.make("other-environment"),
        ThreadId.make("thread"),
        RuntimeRequestId.make("request"),
      ),
    );
    expect(key).not.toBe(
      leadPendingRequestKey(
        EnvironmentId.make("environment"),
        ThreadId.make("other-thread"),
        RuntimeRequestId.make("request"),
      ),
    );
    expect(key).not.toBe(
      leadPendingRequestKey(
        EnvironmentId.make("environment"),
        ThreadId.make("thread"),
        RuntimeRequestId.make("other-request"),
      ),
    );
  });
});

describe("leadPendingAnswersFor", () => {
  it("keeps a request's drafts and index, and starts clean for another request", () => {
    const answered = {
      ...withLeadPendingDraft(emptyLeadPendingAnswers("one"), "note", {
        customAnswer: "Keep it",
      }),
      questionIndex: 2,
    };

    expect(leadPendingAnswersFor(answered, "one")).toBe(answered);
    expect(leadPendingAnswersFor(answered, "two")).toEqual(emptyLeadPendingAnswers("two"));
  });
});

describe("moveLeadPendingQuestion", () => {
  it("moves between questions and stops at both ends", () => {
    let state = emptyLeadPendingAnswers("key");
    state = moveLeadPendingQuestion(state, 3, 1);
    state = moveLeadPendingQuestion(state, 3, 1);
    expect(state.questionIndex).toBe(2);
    expect(moveLeadPendingQuestion(state, 3, 1)).toBe(state);

    state = moveLeadPendingQuestion(state, 3, -1);
    state = moveLeadPendingQuestion(state, 3, -1);
    expect(state.questionIndex).toBe(0);
    expect(moveLeadPendingQuestion(state, 3, -1)).toBe(state);
    expect(moveLeadPendingQuestion(state, 0, 1)).toBe(state);
  });
});

describe("leadPendingAnswersToSubmit", () => {
  it("submits every exact multi-select value and a typed answer", () => {
    let state = emptyLeadPendingAnswers("key");
    state = withLeadPendingDraft(
      state,
      "files",
      togglePendingUserInputOptionSelection(multiQuestion, undefined, "src/a.ts"),
    );
    state = withLeadPendingDraft(
      state,
      "files",
      togglePendingUserInputOptionSelection(multiQuestion, state.drafts.files, "src/b.ts"),
    );
    state = withLeadPendingDraft(
      state,
      "note",
      setPendingUserInputCustomAnswer(freeTextQuestion, undefined, "  Keep it  "),
    );

    expect(leadPendingAnswersToSubmit([multiQuestion, freeTextQuestion], state)).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      note: "Keep it",
    });
  });

  it("lets a suggested answer stand until the user edits it", () => {
    const state = emptyLeadPendingAnswers("key");
    expect(leadPendingAnswersToSubmit([suggestedQuestion], state)).toEqual({
      summary: "  Draft text  ",
    });
    expect(state.drafts).toEqual({});
    expect(leadPendingDrafts([suggestedQuestion], state)).toEqual({
      summary: { customAnswer: "  Draft text  " },
    });
  });

  it("refuses a prompt with an unanswered question or an option-only question with no options", () => {
    const optionOnly = { id: "choice", options: [] } satisfies PendingUserInputQuestion;
    expect(
      leadPendingAnswersToSubmit([multiQuestion, freeTextQuestion], emptyLeadPendingAnswers("key")),
    ).toBeNull();
    expect(leadPendingAnswersToSubmit([optionOnly], emptyLeadPendingAnswers("key"))).toBeNull();
  });
});
