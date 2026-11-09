import { ComposerContextId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { formatLeadObservedAt, formatLeadRoleResolution } from "./copy.ts";
import {
  deriveDismissedLeadAutoContext,
  deriveLeadAutoContext,
  isLeadContextReadable,
  mergeLeadContext,
  type LeadPageContext,
} from "./context.ts";
import {
  clearLeadDraftOnSend,
  dropLeadDraftsForEnvironment,
  dropLeadDraftsForProject,
  emptyLeadDraft,
  readLeadDraft,
  writeLeadDraft,
} from "./draft.ts";
import { leadScopeKey, resolveLeadOpenScope, sameLeadScope, type LeadScope } from "./scope.ts";
import { deriveLeadButtonStatus, type LeadScopeStatus } from "./status.ts";

const envA = EnvironmentId.make("env_a");
const envB = EnvironmentId.make("env_b");
const projectA = ProjectId.make("project_a");
const projectB = ProjectId.make("project_b");
const threadA = ThreadId.make("thread_a");

const scopeA: LeadScope = { environmentId: envA, projectId: projectA };
const scopeB: LeadScope = { environmentId: envA, projectId: projectB };
const scopeOnB: LeadScope = { environmentId: envB, projectId: projectA };

describe("lead scope", () => {
  it("keys a lead by environment and project", () => {
    expect(leadScopeKey(scopeA)).toBe(`${envA}\u0000${projectA}`);
    expect(sameLeadScope(scopeA, { ...scopeA })).toBe(true);
    expect(sameLeadScope(scopeA, scopeB)).toBe(false);
  });

  it("prefers an explicit target, then the retained scope, then the page", () => {
    expect(
      resolveLeadOpenScope({ retained: scopeA, page: scopeB, explicit: scopeOnB }),
    ).toMatchObject({ scope: scopeOnB, source: "explicit" });
    expect(resolveLeadOpenScope({ retained: scopeA, page: scopeB })).toMatchObject({
      scope: scopeA,
      source: "retained",
    });
    expect(resolveLeadOpenScope({ retained: null, page: scopeA })).toMatchObject({
      scope: scopeA,
      source: "page",
    });
    expect(resolveLeadOpenScope({ retained: null, page: null })).toMatchObject({
      scope: null,
      source: "none",
    });
  });

  it("distinguishes another project, another environment and no project", () => {
    expect(resolveLeadOpenScope({ retained: scopeA, page: scopeB }).continuity).toEqual({
      kind: "other-project",
      page: scopeB,
    });
    expect(resolveLeadOpenScope({ retained: scopeA, page: scopeOnB }).continuity).toEqual({
      kind: "other-environment",
      page: scopeOnB,
    });
    expect(resolveLeadOpenScope({ retained: scopeA, page: null }).continuity).toEqual({
      kind: "no-project",
    });
    expect(resolveLeadOpenScope({ retained: scopeA, page: scopeA }).continuity).toEqual({
      kind: "none",
    });
  });
});

describe("lead drafts", () => {
  const now = "2026-11-08T10:00:00.000Z";

  it("never moves a draft between scope keys", () => {
    let drafts = writeLeadDraft({}, scopeA, { ...emptyLeadDraft(now), text: "atlas" });
    drafts = writeLeadDraft(drafts, scopeB, { ...emptyLeadDraft(now), text: "ledger" });
    drafts = writeLeadDraft(drafts, scopeOnB, { ...emptyLeadDraft(now), text: "other host" });

    expect(readLeadDraft(drafts, scopeA)?.text).toBe("atlas");
    expect(readLeadDraft(drafts, scopeB)?.text).toBe("ledger");
    expect(readLeadDraft(drafts, scopeOnB)?.text).toBe("other host");
  });

  it("clears only the sent scope", () => {
    let drafts = writeLeadDraft({}, scopeA, { ...emptyLeadDraft(now), text: "atlas" });
    drafts = writeLeadDraft(drafts, scopeB, { ...emptyLeadDraft(now), text: "ledger" });
    drafts = clearLeadDraftOnSend(drafts, scopeA, "2026-11-08T10:05:00.000Z");

    expect(readLeadDraft(drafts, scopeA)).toEqual(emptyLeadDraft("2026-11-08T10:05:00.000Z"));
    expect(readLeadDraft(drafts, scopeB)?.text).toBe("ledger");
  });

  it("drops drafts with removed projects and environments", () => {
    let drafts = writeLeadDraft({}, scopeA, { ...emptyLeadDraft(now), text: "atlas" });
    drafts = writeLeadDraft(drafts, scopeB, { ...emptyLeadDraft(now), text: "ledger" });
    drafts = writeLeadDraft(drafts, scopeOnB, { ...emptyLeadDraft(now), text: "remote" });

    const withoutProject = dropLeadDraftsForProject(drafts, projectA);
    expect(readLeadDraft(withoutProject, scopeA)).toBeNull();
    expect(readLeadDraft(withoutProject, scopeOnB)).toBeNull();
    expect(readLeadDraft(withoutProject, scopeB)?.text).toBe("ledger");

    const withoutEnvironment = dropLeadDraftsForEnvironment(drafts, envA);
    expect(readLeadDraft(withoutEnvironment, scopeA)).toBeNull();
    expect(readLeadDraft(withoutEnvironment, scopeB)).toBeNull();
    expect(readLeadDraft(withoutEnvironment, scopeOnB)?.text).toBe("remote");
  });
});

describe("lead context", () => {
  const page: LeadPageContext = {
    scope: scopeA,
    thread: { ref: { environmentId: envA, threadId: threadA }, title: "Atlas worker" },
  };

  it("attaches page context only to its own scope", () => {
    expect(deriveLeadAutoContext({ page, scope: scopeA })).toHaveLength(1);
    expect(deriveLeadAutoContext({ page, scope: scopeB })).toHaveLength(0);
    expect(deriveLeadAutoContext({ page, scope: scopeOnB })).toHaveLength(0);
    expect(deriveLeadAutoContext({ page: null, scope: scopeA })).toHaveLength(0);
  });

  it("keeps dismissed documents as re-attachable ghosts", () => {
    const auto = deriveLeadAutoContext({ page, scope: scopeA });
    const key = auto[0]!.contextId;
    expect(deriveLeadAutoContext({ page, scope: scopeA, dismissedKeys: [key] })).toHaveLength(0);
    expect(deriveDismissedLeadAutoContext({ page, scope: scopeA, dismissedKeys: [key] })).toEqual(
      auto,
    );
  });

  it("keeps explicitly added context while auto chips are dismissed", () => {
    const auto = deriveLeadAutoContext({ page, scope: scopeA });
    const added = {
      version: 1 as const,
      kind: "thread" as const,
      contextId: ComposerContextId.make("thread_manual"),
      label: "Manual",
      environmentId: envA,
      threadId: threadA,
      title: "Manual",
    };
    const merged = mergeLeadContext({
      auto,
      added: [added],
      dismissedKeys: [auto[0]!.contextId],
    });
    expect(merged).toEqual([added]);
  });

  it("flags records from another environment as unreadable", () => {
    const [record] = deriveLeadAutoContext({ page, scope: scopeA });
    expect(isLeadContextReadable(record!, envA)).toBe(true);
    expect(isLeadContextReadable(record!, envB)).toBe(false);
  });
});

describe("lead button status", () => {
  const base: LeadScopeStatus = {
    scope: scopeA,
    scopeLabel: "atlas-web",
    environmentLabel: "studio-mac",
    needsYouCount: 0,
    decisionsCount: 0,
    grantActive: false,
    unreadReply: false,
    offline: false,
  };

  it("is hidden without a connected environment", () => {
    expect(deriveLeadButtonStatus({ connectedEnvironmentCount: 0, scopes: [base] })).toMatchObject({
      visible: false,
      label: "Lead",
    });
  });

  it("orders needs-you ahead of ownership and decisions", () => {
    const status = deriveLeadButtonStatus({
      connectedEnvironmentCount: 1,
      scopes: [{ ...base, needsYouCount: 2, decisionsCount: 3, grantActive: true }],
    });
    expect(status.label).toBe("Lead, needs your approval");
    expect(status.needsYouCount).toBe(2);
    expect(status.decisionsCount).toBe(3);
  });

  it("names ownership, decisions, offline and unread states", () => {
    expect(
      deriveLeadButtonStatus({
        connectedEnvironmentCount: 1,
        scopes: [{ ...base, grantActive: true }],
      }).label,
    ).toBe("Lead, owns a batch in atlas-web");
    expect(
      deriveLeadButtonStatus({
        connectedEnvironmentCount: 1,
        scopes: [{ ...base, decisionsCount: 1 }],
      }).label,
    ).toBe("Lead, 1 decision waiting");
    expect(
      deriveLeadButtonStatus({
        connectedEnvironmentCount: 1,
        scopes: [{ ...base, offline: true }],
      }).label,
    ).toBe("Lead, studio-mac offline");
    expect(
      deriveLeadButtonStatus({
        connectedEnvironmentCount: 1,
        scopes: [{ ...base, unreadReply: true }],
      }).label,
    ).toBe("Lead, new reply");
  });
});

describe("lead copy", () => {
  it("names the role source without claiming a substitution", () => {
    expect(
      formatLeadRoleResolution({
        modelLabel: "Opus 5.5 · xhigh",
        source: { kind: "project-role", role: "Lead" },
      }),
    ).toBe("Runs as Opus 5.5 · xhigh (project Lead role)");
    expect(
      formatLeadRoleResolution({
        modelLabel: "Claude · high",
        source: { kind: "conversation-override" },
        roleModelLabel: "Opus 5.5 · xhigh",
      }),
    ).toBe("Runs as Claude · high · chosen for this conversation (Lead role: Opus 5.5 · xhigh)");
  });

  it("marks observations as as-of times", () => {
    expect(
      formatLeadObservedAt("2026-11-08T10:08:00.000Z", {
        now: DateTime.toDate(DateTime.makeUnsafe("2026-11-08T12:00:00.000Z")),
        locale: "en-US",
      }),
    ).toMatch(/^Observed /);
  });
});
