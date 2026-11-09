import type { ComposerContextRecord } from "@t3tools/contracts";

import { leadScopeKey, parseLeadScopeKey, type LeadScope } from "./scope.ts";

export const LEAD_DRAFTS_STORAGE_KEY = "t3code:lead-drafts:v1";

export interface LeadDraft {
  readonly text: string;
  readonly addedContext: ReadonlyArray<ComposerContextRecord>;
  /** Auto-context records the user removed; re-attaching clears the key. */
  readonly dismissedAutoContextKeys: ReadonlyArray<string>;
  readonly updatedAt: string;
}

export type LeadDraftsByScope = Readonly<Record<string, LeadDraft>>;

export function emptyLeadDraft(now: string): LeadDraft {
  return { text: "", addedContext: [], dismissedAutoContextKeys: [], updatedAt: now };
}

/** Reads only this scope's draft; nothing falls back to another project. */
export function readLeadDraft(
  drafts: LeadDraftsByScope,
  scope: LeadScope | null,
): LeadDraft | null {
  return scope === null ? null : (drafts[leadScopeKey(scope)] ?? null);
}

export function writeLeadDraft(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  draft: LeadDraft,
): LeadDraftsByScope {
  return { ...drafts, [leadScopeKey(scope)]: draft };
}

/** Clears the sent text and added chips; the scope key itself never moves. */
export function clearLeadDraftOnSend(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  now: string,
): LeadDraftsByScope {
  return writeLeadDraft(drafts, scope, emptyLeadDraft(now));
}

export function dropLeadDraftsForProject(
  drafts: LeadDraftsByScope,
  projectId: LeadScope["projectId"],
): LeadDraftsByScope {
  return dropLeadDraftsWhere(drafts, (scope) => scope.projectId === projectId);
}

export function dropLeadDraftsForEnvironment(
  drafts: LeadDraftsByScope,
  environmentId: LeadScope["environmentId"],
): LeadDraftsByScope {
  return dropLeadDraftsWhere(drafts, (scope) => scope.environmentId === environmentId);
}

function dropLeadDraftsWhere(
  drafts: LeadDraftsByScope,
  shouldDrop: (scope: LeadScope) => boolean,
): LeadDraftsByScope {
  const kept = Object.entries(drafts).filter(([key]) => {
    const scope = parseLeadScopeKey(key);
    return scope === null || !shouldDrop(scope);
  });
  return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
}
