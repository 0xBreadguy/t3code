import {
  DEFAULT_SERVER_SETTINGS,
  type AgentRole,
  type AgentRoleModelSelections,
} from "@t3tools/contracts";
import type { LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { resolveAgentRoleTarget } from "@t3tools/shared/agentRolePolicy";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { AGENT_ROLE_ROWS } from "../../agentRoleRows";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironment, useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Button } from "../ui/button";

function roleSourceLabel(
  role: AgentRole,
  projectRoles: AgentRoleModelSelections | undefined,
  environmentRoles: AgentRoleModelSelections | undefined,
): string {
  if (projectRoles?.[role] !== undefined) return "Project role";
  if (environmentRoles?.[role] !== undefined) return "Environment role";
  return "Not set";
}

/**
 * Read-only resolution readback. Roles are edited in Settings, scoped to the
 * same environment and project; this view links there and keeps the draft.
 */
export function LeadRolesView({
  scope,
  data,
  environmentLabel,
  onBack,
  onClose,
}: {
  readonly scope: LeadScope;
  readonly data: LeadReadResult | null;
  readonly environmentLabel: string;
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  const environment = useEnvironment(scope.environmentId);
  const providersByEnvironment = useEnvironmentProviders();
  const groups = useSettingsProjectGroups();
  const navigate = useNavigate();
  const settings = environment?.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = providersByEnvironment.get(scope.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, scope.projectId);
  const projectRoles = settings.projectSettingsOverrides[scope.projectId]?.agentRoleModels;
  const boundThread = data?.thread ?? null;
  const leadSelection = data?.roleModels.lead ?? null;
  const boundDiffers =
    boundThread !== null &&
    leadSelection !== null &&
    (boundThread.providerInstanceId !== leadSelection.instanceId ||
      boundThread.model !== leadSelection.model);

  const editRoles = () => {
    const group = groups.find((candidate) =>
      candidate.memberProjects.some(
        (member) => member.environmentId === scope.environmentId && member.id === scope.projectId,
      ),
    );
    void navigate({
      to: "/settings/threads",
      search: group
        ? { project: group.projectKey, machine: scope.environmentId }
        : { machine: scope.environmentId },
      hash: "roles-models",
      hashScrollIntoView: false,
    });
    onClose();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lead-roles="">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-2 py-1.5">
        <Button size="icon-xs" variant="ghost" aria-label="Back to the lead" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <h2 className="text-sm font-medium">Roles &amp; models</h2>
        <Button size="xs" variant="outline" className="ms-auto" onClick={editRoles}>
          Edit roles
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {data === null ? (
          <p className="text-2xs text-muted-foreground">Reading roles…</p>
        ) : (
          <>
            <div className="rounded-md border border-border/70 px-2 py-1.5">
              <p className="text-xs text-foreground">
                {boundThread === null
                  ? "No lead conversation yet."
                  : `This conversation runs as ${boundThread.model} · ${boundThread.providerInstanceId}.`}
              </p>
              {boundThread === null ? null : leadSelection === null ? (
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  No Lead role is set. This conversation was chosen explicitly.
                </p>
              ) : boundDiffers ? (
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  The Lead role is set to {leadSelection.model} · {leadSelection.instanceId}. It
                  applies to future lead launches; this conversation keeps its model.
                </p>
              ) : (
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  This conversation uses the Lead role model.
                </p>
              )}
            </div>
            {AGENT_ROLE_ROWS.map((row) => {
              const selection = data.roleModels[row.role] ?? null;
              const entry =
                selection === null
                  ? undefined
                  : entries.find((candidate) => candidate.instanceId === selection.instanceId);
              const resolution = resolveAgentRoleTarget({
                settings,
                projectId: scope.projectId,
                role: row.role,
                explicitTarget: false,
                providers: entries.map((candidate) => ({
                  instanceId: candidate.instanceId,
                  enabled: candidate.enabled,
                  available: candidate.isAvailable,
                  models: candidate.models,
                })),
              });
              const unavailable =
                resolution.type === "provider_disabled" || resolution.type === "model_unavailable"
                  ? "Not available on this environment. Edit roles or connect the provider."
                  : null;
              return (
                <div
                  key={row.role}
                  className="rounded-md border border-border/60 px-2 py-1.5"
                  data-lead-role={row.role}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{row.title}</span>
                    <span className="shrink-0 text-3xs text-muted-foreground">
                      {roleSourceLabel(row.role, projectRoles, settings.agentRoleModels)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {selection === null
                      ? "Not set · uses the default model"
                      : `${selection.model} · ${entry?.displayName ?? selection.instanceId}`}
                  </p>
                  {unavailable !== null ? (
                    <p className="mt-0.5 text-3xs text-destructive-foreground">{unavailable}</p>
                  ) : null}
                </div>
              );
            })}
            <p className="text-3xs leading-normal text-muted-foreground">
              A review or test model does not run anything by itself. Worker check reports stay
              unverified until you review them. Provider-native subagents may not follow these
              roles.
            </p>
            <p className="text-3xs leading-normal text-muted-foreground">
              Roles are saved per environment, not synced across them. {environmentLabel} keeps its
              own values.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
