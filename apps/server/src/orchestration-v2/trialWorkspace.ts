import type { ProjectId, ThreadId } from "@t3tools/contracts";

export const SETUP_COPY_THREAD_PREFIX = "setup-copy-";
export const SETUP_COPY_PROJECT_PREFIX = "setup-copy-";

export function usesTrialWorkspace(projectId: ProjectId, threadId?: ThreadId): boolean {
  return (
    projectId.startsWith(SETUP_COPY_PROJECT_PREFIX) ||
    threadId?.startsWith(SETUP_COPY_THREAD_PREFIX) === true
  );
}
