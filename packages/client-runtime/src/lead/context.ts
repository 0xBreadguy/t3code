import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import type {
  ComposerContextRecord,
  FileContextRecord,
  ReviewCommentContextRecord,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { sameLeadScope, type LeadScope } from "./scope.ts";

/**
 * Semantic page context the lead may receive. There is deliberately no
 * screenshot, DOM or accessibility-tree field.
 */
export interface LeadPageContext {
  readonly scope: LeadScope | null;
  readonly thread?: {
    readonly ref: ScopedThreadRef;
    readonly title: string;
  } | null;
  readonly reviewComment?: ReviewCommentContextRecord;
  readonly files?: ReadonlyArray<FileContextRecord>;
}

export function leadContextKey(record: ComposerContextRecord): string {
  return record.contextId;
}

/** Records from another environment cannot be read by this environment's agent. */
export function isLeadContextReadable(
  record: ComposerContextRecord,
  environmentId: LeadScope["environmentId"],
): boolean {
  if (record.kind === "thread" && "environmentId" in record) {
    return record.environmentId === environmentId;
  }
  if (record.kind === "environment" && "environmentId" in record) {
    return record.environmentId === environmentId;
  }
  return true;
}

/**
 * Auto context exists only while the page is the lead's own project in the
 * same environment. Navigating elsewhere never re-attaches a chip.
 */
export function deriveLeadAutoContext(input: {
  readonly page: LeadPageContext | null;
  readonly scope: LeadScope | null;
  readonly dismissedKeys?: ReadonlyArray<string>;
}): ReadonlyArray<ComposerContextRecord> {
  const { page, scope } = input;
  if (page === null || scope === null || !sameLeadScope(page.scope, scope)) return [];
  const dismissed = new Set(input.dismissedKeys ?? []);
  const records: Array<ComposerContextRecord> = [];
  if (
    page.thread != null &&
    page.thread.ref.environmentId === scope.environmentId &&
    !dismissed.has(leadContextKey(threadContextRecord(page.thread.ref, page.thread.title)))
  ) {
    records.push(threadContextRecord(page.thread.ref, page.thread.title));
  }
  if (page.reviewComment !== undefined && !dismissed.has(leadContextKey(page.reviewComment))) {
    records.push(page.reviewComment);
  }
  for (const file of page.files ?? []) {
    if (!dismissed.has(leadContextKey(file))) records.push(file);
  }
  return dedupeContext(records);
}

/** Auto chips the user removed, shown as re-attachable ghosts. */
export function deriveDismissedLeadAutoContext(input: {
  readonly page: LeadPageContext | null;
  readonly scope: LeadScope | null;
  readonly dismissedKeys?: ReadonlyArray<string>;
}): ReadonlyArray<ComposerContextRecord> {
  const dismissed = new Set(input.dismissedKeys ?? []);
  return deriveLeadAutoContext({ ...input, dismissedKeys: [] }).filter((record) =>
    dismissed.has(leadContextKey(record)),
  );
}

/**
 * Auto records plus chips the user attached by hand. Dismissal applies only to
 * auto records; an explicitly attached record stays until the user removes it.
 */
export function mergeLeadContext(input: {
  readonly auto: ReadonlyArray<ComposerContextRecord>;
  readonly added?: ReadonlyArray<ComposerContextRecord>;
  readonly dismissedKeys?: ReadonlyArray<string>;
}): ReadonlyArray<ComposerContextRecord> {
  const dismissed = new Set(input.dismissedKeys ?? []);
  return dedupeContext([
    ...input.auto.filter((record) => !dismissed.has(leadContextKey(record))),
    ...(input.added ?? []),
  ]);
}

function dedupeContext(
  records: ReadonlyArray<ComposerContextRecord>,
): ReadonlyArray<ComposerContextRecord> {
  const seen = new Set<string>();
  const result: Array<ComposerContextRecord> = [];
  for (const record of records) {
    const key = leadContextKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}
