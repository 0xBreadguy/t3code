import type {
  LeadHandoff,
  LeadState,
  ProjectId,
  ProjectLeadConfig,
  ProjectLeadWorkerFinish,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";

const LEAD_HANDOFF_LIMIT = 100;

/**
 * Dedupe is by source run and head, so a retried tool call adds nothing while a
 * new commit on the same run is a new record. Ownership is never touched here.
 */
export function appendLeadHandoff(
  state: LeadState | null,
  handoff: LeadHandoff,
): { readonly state: LeadState; readonly created: boolean } {
  const existing = state?.handoffs.find(
    (entry) => entry.sourceRunId === handoff.sourceRunId && entry.head === handoff.head,
  );
  if (existing !== undefined) {
    return { state: state ?? { revision: 0, handoffs: [], ownership: null }, created: false };
  }
  return {
    state: {
      revision: state?.revision ?? 0,
      handoffs: [...(state?.handoffs ?? []), handoff].slice(-LEAD_HANDOFF_LIMIT),
      ownership: state?.ownership ?? null,
    },
    created: true,
  };
}

/** Stable even when thread creation succeeded and the settings write failed. */
export function leadThreadIdForProject(projectId: ProjectId): string {
  return `lead:${projectId}`;
}

function projectLeadConfig(
  settings: Pick<ServerSettings, "projectLeadConfigs">,
  projectId: ProjectId,
): ProjectLeadConfig | null {
  return settings.projectLeadConfigs[projectId] ?? null;
}

export function leadWorkerFinishMode(
  config: Pick<ProjectLeadConfig, "workerDefault" | "workerFinishOverrides">,
  threadId: ThreadId,
): ProjectLeadWorkerFinish {
  return config.workerFinishOverrides[threadId] ?? config.workerDefault;
}

/**
 * The single finishing-policy text for a worker turn. Injected where every
 * provider turn already receives system context; null means the project has
 * no lead, which leaves unrelated projects' prompts unchanged.
 */
export function leadWorkerGuidance(
  settings: Pick<ServerSettings, "projectLeadConfigs">,
  projectId: ProjectId,
  threadId: ThreadId,
): string | null {
  const config = projectLeadConfig(settings, projectId);
  if (config === null || config.threadId === threadId) return null;
  const mode = leadWorkerFinishMode(config, threadId);
  if (mode === "independent") {
    return [
      "## Finishing work for this project",
      "This project uses independent workers. Verify the work you changed and leave it on your branch.",
      "Do not open a pull request unless the user asked you to. A turn ending is not proof that work is ready.",
    ].join("\n");
  }
  return [
    "## Finishing work for this project",
    "This project has a lead thread that coordinates worker tasks.",
    "When you finish, call `lead_handoff` with a short summary and the checks you actually ran and their outcomes.",
    "Leave changes on your branch and do not open a pull request unless the user asked you to.",
    "Ending your turn is not a handoff, and a claim alone does not mark work ready or verified.",
  ].join("\n");
}
