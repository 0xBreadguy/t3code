import { useAtomValue } from "@effect/atom-react";
import { ProjectId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { environmentPresentations } from "../../state/presentation";
import { environmentThreadShells } from "../../state/threads";
import {
  deriveLeadAttention,
  sameLeadAttention,
  type LeadAttentionInput,
  type LeadAttentionLead,
} from "./leadAttention.logic";

const EMPTY_LEAD_ATTENTION: ReadonlyArray<LeadAttentionLead> = Object.freeze([]);

/**
 * Every configured lead thread's shell is already in memory, so a closed lead
 * still reports a pending approval or question without opening its projection.
 */
const leadAttentionAtom = Atom.make((get): ReadonlyArray<LeadAttentionLead> => {
  const inputs: LeadAttentionInput[] = [];
  for (const [environmentId, config] of get(environmentPresentations.serverConfigsAtom)) {
    if (config.projectLead !== true) continue;
    const threads = new Map<string, OrchestrationV2ThreadShell>(
      get(environmentThreadShells.environmentThreadsAtom(environmentId)).map((thread) => [
        thread.id,
        thread,
      ]),
    );
    for (const [projectId, binding] of Object.entries(config.settings.projectLeadConfigs)) {
      inputs.push({
        environmentId,
        projectId: ProjectId.make(projectId),
        threadId: binding.threadId,
        shell: threads.get(binding.threadId) ?? null,
      });
    }
  }

  const next = inputs.length === 0 ? EMPTY_LEAD_ATTENTION : deriveLeadAttention(inputs);
  const previous = Option.getOrNull(get.self<ReadonlyArray<LeadAttentionLead>>());
  return previous !== null && sameLeadAttention(previous, next) ? previous : next;
}).pipe(Atom.withLabel("web-lead-attention"));

export function useLeadAttention(): ReadonlyArray<LeadAttentionLead> {
  return useAtomValue(leadAttentionAtom);
}
