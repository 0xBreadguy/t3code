import {
  clearLeadDraftOnSend,
  dropLeadDraftsForEnvironment,
  dropLeadDraftsForProject,
  emptyLeadDraft,
  LEAD_DRAFTS_STORAGE_KEY,
  readLeadDraft,
  writeLeadDraft,
  type LeadDraft,
  type LeadDraftsByScope,
} from "@t3tools/client-runtime/lead/draft";
import { leadContextKey } from "@t3tools/client-runtime/lead/context";
import { leadScopeKey, type LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { ComposerContextRecord } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface LeadDraftStoreState {
  draftsByScope: LeadDraftsByScope;
  setText: (scope: LeadScope, text: string) => void;
  addContext: (scope: LeadScope, record: ComposerContextRecord) => void;
  removeContext: (scope: LeadScope, contextKey: string) => void;
  dismissAutoContext: (scope: LeadScope, contextKey: string) => void;
  reattachAutoContext: (scope: LeadScope, contextKey: string) => void;
  clearOnSend: (scope: LeadScope) => void;
  dropForProject: (projectId: LeadScope["projectId"]) => void;
  dropForEnvironment: (environmentId: LeadScope["environmentId"]) => void;
}

const nowIso = () => new Date().toISOString();

function readOrEmpty(drafts: LeadDraftsByScope, scope: LeadScope): LeadDraft {
  return readLeadDraft(drafts, scope) ?? emptyLeadDraft(nowIso());
}

function updateScope(
  drafts: LeadDraftsByScope,
  scope: LeadScope,
  update: (draft: LeadDraft) => LeadDraft,
): LeadDraftsByScope {
  if (readLeadDraft(drafts, scope) === null) return drafts;
  return writeLeadDraft(drafts, scope, update(readLeadDraft(drafts, scope)!));
}

export const useLeadDraftStore = create<LeadDraftStoreState>()(
  persist(
    (set) => ({
      draftsByScope: {},
      setText: (scope, text) =>
        set((state) => {
          const current = readOrEmpty(state.draftsByScope, scope);
          return {
            draftsByScope: writeLeadDraft(state.draftsByScope, scope, {
              ...current,
              text,
              updatedAt: nowIso(),
            }),
          };
        }),
      addContext: (scope, record) =>
        set((state) => {
          const current = readOrEmpty(state.draftsByScope, scope);
          if (
            current.addedContext.some((entry) => leadContextKey(entry) === leadContextKey(record))
          ) {
            return state;
          }
          return {
            draftsByScope: writeLeadDraft(state.draftsByScope, scope, {
              ...current,
              addedContext: [...current.addedContext, record],
              updatedAt: nowIso(),
            }),
          };
        }),
      removeContext: (scope, contextKey) =>
        set((state) => ({
          draftsByScope: updateScope(state.draftsByScope, scope, (draft) => ({
            ...draft,
            addedContext: draft.addedContext.filter(
              (record) => leadContextKey(record) !== contextKey,
            ),
            updatedAt: nowIso(),
          })),
        })),
      dismissAutoContext: (scope, contextKey) =>
        set((state) => {
          const current = readOrEmpty(state.draftsByScope, scope);
          if (current.dismissedAutoContextKeys.includes(contextKey)) return state;
          return {
            draftsByScope: writeLeadDraft(state.draftsByScope, scope, {
              ...current,
              dismissedAutoContextKeys: [...current.dismissedAutoContextKeys, contextKey],
              updatedAt: nowIso(),
            }),
          };
        }),
      reattachAutoContext: (scope, contextKey) =>
        set((state) => ({
          draftsByScope: updateScope(state.draftsByScope, scope, (draft) => ({
            ...draft,
            dismissedAutoContextKeys: draft.dismissedAutoContextKeys.filter(
              (key) => key !== contextKey,
            ),
            updatedAt: nowIso(),
          })),
        })),
      clearOnSend: (scope) =>
        set((state) => ({
          draftsByScope: clearLeadDraftOnSend(state.draftsByScope, scope, nowIso()),
        })),
      dropForProject: (projectId) =>
        set((state) => ({
          draftsByScope: dropLeadDraftsForProject(state.draftsByScope, projectId),
        })),
      dropForEnvironment: (environmentId) =>
        set((state) => ({
          draftsByScope: dropLeadDraftsForEnvironment(state.draftsByScope, environmentId),
        })),
    }),
    {
      name: LEAD_DRAFTS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ draftsByScope: state.draftsByScope }),
    },
  ),
);

export function useLeadDraft(scope: LeadScope | null): LeadDraft | null {
  const draftsByScope = useLeadDraftStore((state) => state.draftsByScope);
  return scope === null ? null : (draftsByScope[leadScopeKey(scope)] ?? null);
}
