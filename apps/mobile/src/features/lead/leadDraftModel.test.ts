import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import {
  clearLeadDraftAfterSend,
  dismissLeadAutoContext,
  readScopeDraft,
  reattachLeadAutoContext,
  sanitizeLeadDrafts,
  setLeadDraftText,
} from "./leadDraftModel";

const scopeA = {
  environmentId: EnvironmentId.make("env-a"),
  projectId: ProjectId.make("project-a"),
};
const scopeB = {
  environmentId: EnvironmentId.make("env-a"),
  projectId: ProjectId.make("project-b"),
};

const threadRecord = threadContextRecord(
  scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("thread-1")),
  "worker thread",
);

describe("lead draft model", () => {
  it("keys drafts by environment and project, never moving text between them", () => {
    const drafts = setLeadDraftText({}, scopeA, "atlas note");

    expect(readScopeDraft(drafts, scopeA)?.text).toBe("atlas note");
    expect(readScopeDraft(drafts, scopeB)).toBeNull();
    expect(
      readScopeDraft(drafts, { ...scopeB, environmentId: EnvironmentId.make("env-b") }),
    ).toBeNull();
  });

  it("clears only the sending scope", () => {
    let drafts = setLeadDraftText({}, scopeA, "atlas note");
    drafts = setLeadDraftText(drafts, scopeB, "ledger note");

    const cleared = clearLeadDraftAfterSend(drafts, scopeA);

    expect(readScopeDraft(cleared, scopeA)?.text).toBe("");
    expect(readScopeDraft(cleared, scopeB)?.text).toBe("ledger note");
  });

  it("keeps removed auto context re-attachable", () => {
    const key = threadRecord.contextId;
    const dismissed = dismissLeadAutoContext({}, scopeA, key);
    expect(readScopeDraft(dismissed, scopeA)?.dismissedAutoContextKeys).toEqual([key]);

    const reattached = reattachLeadAutoContext(dismissed, scopeA, key);
    expect(readScopeDraft(reattached, scopeA)?.dismissedAutoContextKeys).toEqual([]);
  });

  it("drops malformed persisted scopes and keeps well-formed drafts", () => {
    const drafts = sanitizeLeadDrafts({
      "env-a\u0000project-a": {
        text: "keep",
        addedContext: [threadRecord, { nope: true }],
        dismissedAutoContextKeys: ["x", 4],
      },
      "no-separator": { text: "drop" },
      "env-b\u0000project-b": "not a draft",
    });

    expect(Object.keys(drafts)).toEqual(["env-a\u0000project-a"]);
    expect(drafts["env-a\u0000project-a"]?.text).toBe("keep");
    expect(drafts["env-a\u0000project-a"]?.addedContext).toEqual([threadRecord]);
    expect(drafts["env-a\u0000project-a"]?.dismissedAutoContextKeys).toEqual(["x"]);
  });
});
