import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { countLeadThreadsNeedingAttention, leadThreadRefsFromConfigs } from "./leadAttention";
import { environmentServerConfigsAtom } from "./server";
import { environmentThreadShells } from "./threads";

/** Reads only the lightweight thread shells, never the full lead transcript. */
const leadAttentionCountAtom = Atom.make((get) =>
  countLeadThreadsNeedingAttention(
    leadThreadRefsFromConfigs(get(environmentServerConfigsAtom)),
    (ref) => get(environmentThreadShells.quietThreadShellAtom(ref)),
  ),
).pipe(Atom.withLabel("mobile-lead-attention-count"));

export function useLeadAttentionCount(): number {
  return useAtomValue(leadAttentionCountAtom);
}
