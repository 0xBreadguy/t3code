import { leadContextKey } from "@t3tools/client-runtime/lead/context";
import {
  clearLeadDraftOnSend,
  emptyLeadDraft,
  readLeadDraft,
  writeLeadDraft,
  type LeadDraft,
  type LeadDraftsByScope,
} from "@t3tools/client-runtime/lead/draft";
import { parseLeadScopeKey, type LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { ComposerContextRecord } from "@t3tools/contracts";

function nowIso(): string {
  return new Date().toISOString();
}

/** Reads this scope's draft only; another scope's draft is never substituted. */
export function readScopeDraft(drafts: LeadDraftsByScope, scope: LeadScope): LeadDraft | null {
  return readLeadDraft(drafts, scope);
}

function updateScope(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  update: (draft: LeadDraft) => LeadDraft,
): LeadDraftsByScope {
  return writeLeadDraft(
    drafts,
    scope,
    update(readLeadDraft(drafts, scope) ?? emptyLeadDraft(nowIso())),
  );
}

export function setLeadDraftText(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  text: string,
): LeadDraftsByScope {
  return updateScope(drafts, scope, (draft) => ({ ...draft, text, updatedAt: nowIso() }));
}

export function removeLeadDraftContext(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  contextKey: string,
): LeadDraftsByScope {
  return updateScope(drafts, scope, (draft) => ({
    ...draft,
    addedContext: draft.addedContext.filter((record) => leadContextKey(record) !== contextKey),
    updatedAt: nowIso(),
  }));
}

/** Auto records the user removed stay in the draft as re-attachable keys. */
export function dismissLeadAutoContext(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  contextKey: string,
): LeadDraftsByScope {
  return updateScope(drafts, scope, (draft) =>
    draft.dismissedAutoContextKeys.includes(contextKey)
      ? draft
      : {
          ...draft,
          dismissedAutoContextKeys: [...draft.dismissedAutoContextKeys, contextKey],
          updatedAt: nowIso(),
        },
  );
}

export function reattachLeadAutoContext(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  contextKey: string,
): LeadDraftsByScope {
  return updateScope(drafts, scope, (draft) => ({
    ...draft,
    dismissedAutoContextKeys: draft.dismissedAutoContextKeys.filter((key) => key !== contextKey),
    updatedAt: nowIso(),
  }));
}

export function clearLeadDraftAfterSend(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
): LeadDraftsByScope {
  return clearLeadDraftOnSend(drafts, scope, nowIso());
}

function isContextRecord(value: unknown): value is ComposerContextRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "contextId" in value &&
    typeof (value as { readonly contextId: unknown }).contextId === "string" &&
    "kind" in value &&
    typeof (value as { readonly kind: unknown }).kind === "string"
  );
}

/** Persisted drafts are untrusted: keep only well-formed scopes and fields. */
export function sanitizeLeadDrafts(raw: unknown): LeadDraftsByScope {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const drafts: Record<string, LeadDraft> = {};
  for (const [key, value] of Object.entries(raw)) {
    const scope = parseLeadScopeKey(key);
    if (scope === null || typeof value !== "object" || value === null) continue;
    const draft = value as Record<string, unknown>;
    drafts[key] = {
      text: typeof draft.text === "string" ? draft.text : "",
      addedContext: Array.isArray(draft.addedContext)
        ? draft.addedContext.filter(isContextRecord)
        : [],
      dismissedAutoContextKeys: Array.isArray(draft.dismissedAutoContextKeys)
        ? draft.dismissedAutoContextKeys.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : nowIso(),
    };
  }
  return drafts;
}
