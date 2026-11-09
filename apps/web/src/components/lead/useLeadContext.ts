import {
  deriveLeadAutoContext,
  deriveDismissedLeadAutoContext,
  isLeadContextReadable,
  mergeLeadContext,
  type LeadPageContext,
} from "@t3tools/client-runtime/lead/context";
import type { LeadDraft } from "@t3tools/client-runtime/lead/draft";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { ComposerContextRecord } from "@t3tools/contracts";

import { useLeadDraft } from "./leadDraftStore";

export interface LeadComposerContext {
  readonly draft: LeadDraft | null;
  readonly auto: ReadonlyArray<ComposerContextRecord>;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly unreadable: ReadonlyArray<ComposerContextRecord>;
  readonly dismissedAuto: ReadonlyArray<ComposerContextRecord>;
}

export function useLeadComposerContext(
  scope: LeadScope | null,
  page: LeadPageContext | null,
): LeadComposerContext {
  const draft = useLeadDraft(scope);
  const dismissedKeys = draft?.dismissedAutoContextKeys ?? [];
  const auto = deriveLeadAutoContext({ page, scope, dismissedKeys });
  const dismissedAuto = deriveDismissedLeadAutoContext({ page, scope, dismissedKeys });
  const records = mergeLeadContext({
    auto,
    added: draft?.addedContext ?? [],
    dismissedKeys,
  });
  const unreadable =
    scope === null
      ? records
      : records.filter((record) => !isLeadContextReadable(record, scope.environmentId));
  return { draft, auto, records, unreadable, dismissedAuto };
}
