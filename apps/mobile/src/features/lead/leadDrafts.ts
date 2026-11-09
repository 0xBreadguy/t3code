import type { LeadDraftsByScope } from "@t3tools/client-runtime/lead/draft";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { writeFileAtomically } from "../../lib/atomic-file";
import { appAtomRegistry } from "../../state/atom-registry";
import { readScopeDraft, sanitizeLeadDrafts } from "./leadDraftModel";

const LEAD_DRAFTS_DIRECTORY = "lead-drafts";
const LEAD_DRAFTS_FILE = "drafts.json";
const PERSIST_DEBOUNCE_MS = 200;

/** Drafts belong to one environment and project; closing the sheet never clears them. */
export const leadDraftsAtom = Atom.make<LeadDraftsByScope>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:lead-drafts"),
);

let loadPromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function leadDraftsFile() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, LEAD_DRAFTS_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, LEAD_DRAFTS_FILE);
}

async function persistLeadDrafts(): Promise<void> {
  // Hydration merges saved scopes in; writing before it would clobber them.
  if (loadPromise !== null) await loadPromise;
  const encoded = JSON.stringify(appAtomRegistry.get(leadDraftsAtom));
  const file = await leadDraftsFile();
  await writeFileAtomically(file, encoded);
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeChain = writeChain
      .then(() => persistLeadDrafts())
      .catch((error: unknown) => {
        console.warn("[lead-drafts] failed to persist drafts", error);
      });
  }, PERSIST_DEBOUNCE_MS);
}

export function updateLeadDrafts(update: (drafts: LeadDraftsByScope) => LeadDraftsByScope): void {
  const current = appAtomRegistry.get(leadDraftsAtom);
  const next = update(current);
  if (next === current) return;
  appAtomRegistry.set(leadDraftsAtom, next);
  schedulePersist();
}

/** Hydration merges persisted scopes beneath anything typed before it finished. */
function ensureLeadDraftsLoaded(): void {
  if (loadPromise !== null) return;
  const loading = (async () => {
    try {
      const file = await leadDraftsFile();
      if (!file.exists) return;
      const persisted = sanitizeLeadDrafts(JSON.parse(await file.text()) as unknown);
      if (Object.keys(persisted).length === 0) return;
      const current = appAtomRegistry.get(leadDraftsAtom);
      appAtomRegistry.set(leadDraftsAtom, { ...persisted, ...current });
    } catch (error) {
      console.warn("[lead-drafts] failed to load drafts", error);
    }
  })();
  loadPromise = loading;
  void loading.catch(() => {
    if (loadPromise === loading) loadPromise = null;
  });
}

void ensureLeadDraftsLoaded();

function useLeadDrafts(): LeadDraftsByScope {
  return useAtomValue(leadDraftsAtom);
}

export function useLeadDraft(scope: LeadScope | null) {
  const drafts = useLeadDrafts();
  return scope === null ? null : readScopeDraft(drafts, scope);
}
