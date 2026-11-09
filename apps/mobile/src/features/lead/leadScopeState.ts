import { useAtomValue } from "@effect/atom-react";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";

/**
 * The last scope the lead was opened for. It survives closing the sheet so
 * reopening resumes that conversation; it is not a destination of its own.
 */
export const retainedLeadScopeAtom = Atom.make<LeadScope | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:lead-retained-scope"),
);

export function useRetainedLeadScope(): LeadScope | null {
  return useAtomValue(retainedLeadScopeAtom);
}

export function setRetainedLeadScope(scope: LeadScope | null): void {
  appAtomRegistry.set(retainedLeadScopeAtom, scope);
}
