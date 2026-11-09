import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { LeadContinuity, LeadScope } from "@t3tools/client-runtime/lead/scope";
import { useProject } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { Button } from "../ui/button";

export function LeadContinuityBar({
  continuity,
  scope,
  onSwitch,
}: {
  readonly continuity: LeadContinuity;
  readonly scope: LeadScope;
  readonly onSwitch: (scope: LeadScope) => void;
}) {
  const scopeProject = useProject(scopeProjectRef(scope.environmentId, scope.projectId));
  const pageProject = useProject(
    continuity.kind === "other-project" || continuity.kind === "other-environment"
      ? scopeProjectRef(continuity.page.environmentId, continuity.page.projectId)
      : null,
  );
  const scopeEnvironment = useEnvironment(scope.environmentId);
  const pageEnvironment = useEnvironment(
    continuity.kind === "other-environment" ? continuity.page.environmentId : null,
  );
  const scopeLabel = scopeProject?.title ?? "another project";

  if (continuity.kind === "none") return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border/70 bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground"
      data-lead-continuity=""
    >
      {continuity.kind === "no-project" ? (
        <span>Continuing {scopeLabel}. This page isn't in a project.</span>
      ) : continuity.kind === "other-project" ? (
        <span>
          Continuing <strong className="text-foreground">{scopeLabel}</strong>. You're viewing{" "}
          {pageProject?.title ?? "another project"}.
        </span>
      ) : (
        <span>
          Continuing <strong className="text-foreground">{scopeLabel}</strong> on{" "}
          {scopeEnvironment?.label ?? "its environment"}. You're viewing it on{" "}
          {pageEnvironment?.label ?? "another environment"}.
        </span>
      )}
      {continuity.kind !== "no-project" ? (
        <Button size="xs" variant="ghost" onClick={() => onSwitch({ ...continuity.page })}>
          Switch
        </Button>
      ) : null}
    </div>
  );
}
