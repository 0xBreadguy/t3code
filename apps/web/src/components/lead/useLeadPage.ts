import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { leadScopeKey } from "@t3tools/client-runtime/lead/scope";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useThreadShell } from "../../state/entities";

export interface LeadPage {
  readonly scope: LeadScope | null;
  readonly thread: { readonly ref: ScopedThreadRef; readonly title: string } | null;
}

interface StableLeadScope {
  readonly key: string | null;
  readonly scope: LeadScope | null;
}

function resolveScopeKey(scope: LeadScope | null): string | null {
  return scope === null ? null : leadScopeKey(scope);
}

/**
 * The page's project for lead context. A server thread resolves through its
 * shell; a draft resolves through its stored session. Settings and other
 * project-neutral routes report no scope.
 */
export function useLeadPage(): LeadPage {
  const target = useThreadRouteTarget();
  const serverRef = target?.kind === "server" ? target.threadRef : null;
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const shell = useThreadShell(serverRef);
  const draftSession = useComposerDraftStore((state) =>
    draftId === null ? null : (state.draftThreadsByThreadKey[draftId] ?? null),
  );

  const nextScope: LeadScope | null =
    serverRef !== null && shell !== null
      ? scopeProjectRef(serverRef.environmentId, shell.projectId)
      : draftSession !== null
        ? { environmentId: draftSession.environmentId, projectId: draftSession.projectId }
        : null;
  const nextKey = resolveScopeKey(nextScope);
  const [stableScope, setStableScope] = useState<StableLeadScope>(() => ({
    key: nextKey,
    scope: nextScope,
  }));
  if (stableScope.key !== nextKey) {
    setStableScope({ key: nextKey, scope: nextScope });
  }
  const scope = stableScope.key === nextKey ? stableScope.scope : nextScope;
  const thread =
    serverRef !== null && shell !== null
      ? { ref: serverRef, title: shell.title?.trim() || "Current thread" }
      : null;

  return { scope, thread };
}
