import {
  type AgentRole,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";

import { AGENT_ROLE_ROWS } from "../../agentRoleRows";
import { getCustomModelOptionsByInstance, selectsPlanAgent } from "../../modelSelection";
import { providerInstanceEntriesFor, type ProviderInstanceEntry } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { RoleInstructionsEditor } from "./RoleInstructionsEditor";
import { roleInstructionScopeKey, type RoleInstructionTarget } from "./roleInstructions";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type SettingsScope = ReturnType<typeof useSettingsScope>;
type SettingsTarget = SettingsScope["targets"][number];

function environmentRole(
  environmentSettingsById: ReadonlyMap<string, ServerSettings>,
  environmentId: string,
  role: AgentRole,
): ModelSelection | undefined {
  return environmentSettingsById.get(environmentId)?.agentRoleModels[role];
}

function projectRole(target: SettingsTarget, role: AgentRole): ModelSelection | undefined {
  return target.projectId === null
    ? undefined
    : target.settings.projectSettingsOverrides[target.projectId]?.agentRoleModels?.[role];
}

/** The server merges sparse project roles over the environment; display the same value. */
function effectiveRole(
  target: SettingsTarget,
  environmentSettingsById: ReadonlyMap<string, ServerSettings>,
  role: AgentRole,
): ModelSelection | null {
  return (
    projectRole(target, role) ??
    environmentRole(environmentSettingsById, target.environmentId, role) ??
    null
  );
}

function modelAvailability(
  selection: ModelSelection,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptions: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<{ slug: string; isUnavailable?: boolean | undefined }>
  >,
  environmentLabel: string,
): string | null {
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  if (entry === undefined) {
    return `${selection.instanceId} is not configured on ${environmentLabel}.`;
  }
  if (!entry.enabled) return `${entry.displayName} is disabled on ${environmentLabel}.`;
  if (!entry.isAvailable) return `${entry.displayName} is unavailable on ${environmentLabel}.`;
  const option = (modelOptions.get(selection.instanceId) ?? []).find(
    (candidate) => candidate.slug === selection.model,
  );
  if (option === undefined) {
    return `${selection.model} is not offered by ${entry.displayName} on ${environmentLabel}.`;
  }
  if (option.isUnavailable) {
    return `${selection.model} is unavailable on ${environmentLabel}.`;
  }
  return null;
}

function RoleRow({
  role,
  title,
  description,
  selection,
  mixed,
  sourceLabel,
  showReset,
  settings,
  providers,
  entries,
  environmentId,
  environmentLabel,
  modelDisabledReason,
  instructionTargets,
  instructionScopeKey,
  projectScope,
  onChange,
  onReset,
}: {
  readonly role: AgentRole;
  readonly title: string;
  readonly description: string;
  readonly selection: ModelSelection | null;
  readonly mixed: boolean;
  readonly sourceLabel: string;
  readonly showReset: boolean;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly environmentId: EnvironmentId | null;
  readonly environmentLabel: string;
  readonly modelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  /** Null hides the fold when a selected server cannot persist or advertise instructions. */
  readonly instructionTargets: ReadonlyArray<RoleInstructionTarget> | null;
  readonly instructionScopeKey: string;
  readonly projectScope: boolean;
  readonly onChange: (selection: ModelSelection) => void;
  readonly onReset: () => void;
}) {
  const navigate = useNavigate();
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId ?? null,
    selection?.model ?? null,
  );
  const entry =
    selection === null
      ? undefined
      : entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const activeInstanceId =
    selection?.instanceId ??
    entries.find((candidate) => candidate.enabled && candidate.isAvailable)?.instanceId ??
    entries[0]?.instanceId ??
    null;
  const unavailableReason =
    selection === null
      ? null
      : modelAvailability(selection, entries, modelOptions, environmentLabel);
  const status =
    unavailableReason !== null
      ? `${unavailableReason} Choose another model, or connect the provider.`
      : sourceLabel;
  const triggerLabel = mixed
    ? "Mixed"
    : selection === null
      ? "Not set"
      : unavailableReason !== null
        ? `${selection.model} (Unavailable)`
        : null;

  return (
    <SettingsRow
      serverScoped
      settingKeys={[]}
      environmentWide={false}
      mixed={mixed}
      id={`role-${role}`}
      title={title}
      description={description}
      status={status}
      resetAction={
        showReset ? (
          <SettingResetButton
            label={`${title.toLowerCase()} model`}
            tooltip="Reset model"
            onClick={onReset}
          />
        ) : null
      }
      control={
        activeInstanceId === null ? (
          <span className="text-sm text-muted-foreground">No providers available</span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={environmentId}
              activeInstanceId={activeInstanceId}
              model={selection?.model ?? ""}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              triggerAriaLabel={`${title} model`}
              {...(triggerLabel === null ? {} : { triggerLabel })}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (environmentId === null) return;
                void navigate({
                  to: "/settings/providers",
                  search: { environmentId, instanceId },
                });
              }}
              onInstanceModelChange={(instanceId, model) => {
                const reason = modelDisabledReason(instanceId, model);
                if (reason !== null) {
                  toastManager.add({
                    type: "error",
                    title: `${title} model not saved`,
                    description: reason,
                  });
                  return;
                }
                onChange(createModelSelection(instanceId, model));
              }}
            />
            {selection !== null && entry !== undefined && !mixed ? (
              <TraitsPicker
                provider={entry.driverKind}
                models={entry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                includePlanAgent={selectsPlanAgent(selection.options)}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  onChange(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        )
      }
    >
      {instructionTargets === null ? null : (
        <RoleInstructionsEditor
          key={`${role}:${instructionScopeKey}`}
          role={role}
          title={title}
          projectScope={projectScope}
          targets={instructionTargets}
          environmentLabel={environmentLabel}
        />
      )}
    </SettingsRow>
  );
}

export function RolesSettings() {
  const { scope, target, connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative =
    target === null
      ? undefined
      : environments.find((environment) => environment.environmentId === target.environmentId);
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const environmentSettingsById = new Map(
    connectedEnvironments.flatMap((environment) =>
      environment.serverConfig
        ? [[environment.environmentId, environment.serverConfig.settings] as const]
        : [],
    ),
  );
  const environmentLabel = representative?.label ?? "this environment";
  const instructionDefaultsByEnvironment = new Map(
    connectedEnvironments.flatMap((environment) => {
      const defaults = environment.serverConfig?.agentRoleInstructionDefaults;
      return defaults === undefined ? [] : ([[environment.environmentId, defaults]] as const);
    }),
  );
  // A server stores only the roles it advertises. An older eight-role server
  // would silently drop a security write, so keep that row off it entirely.
  const roleSupported = (role: AgentRole): boolean =>
    role !== "security" ||
    (targets.length > 0 &&
      targets.every(
        (candidate) =>
          instructionDefaultsByEnvironment.get(candidate.environmentId)?.security !== undefined,
      ));

  return (
    <SettingsSection id="roles-models" title="Roles & models">
      {AGENT_ROLE_ROWS.filter((row) => roleSupported(row.role)).map((row) => {
        const selections = targets.map((candidate) =>
          effectiveRole(candidate, environmentSettingsById, row.role),
        );
        const mixed =
          selections.length > 1 &&
          selections.some((selection) => !Equal.equals(selection, selections[0]));
        const selection = target ? effectiveRole(target, environmentSettingsById, row.role) : null;
        const override = target ? projectRole(target, row.role) : undefined;
        const showReset = isProjectScope
          ? targets.some((candidate) => projectRole(candidate, row.role) !== undefined)
          : targets.some(
              (candidate) =>
                environmentRole(environmentSettingsById, candidate.environmentId, row.role) !==
                undefined,
            );
        const representativeTarget = target ?? targets[0] ?? null;
        const resolved =
          representativeTarget === null
            ? null
            : effectiveRole(representativeTarget, environmentSettingsById, row.role);
        const sourceLabel = mixed
          ? "Model mixed across selected environments"
          : isProjectScope && override !== undefined
            ? "Model set for this project"
            : resolved !== null
              ? isProjectScope
                ? `Model inherited from ${environmentLabel}`
                : targets.length > 1
                  ? "Model set on selected environments"
                  : `Model set on ${environmentLabel}`
              : "No model set · uses the default model";
        const instructionTargets = isProjectScope
          ? targets.flatMap((candidate) => {
              const builtIn = instructionDefaultsByEnvironment.get(candidate.environmentId)?.[
                row.role
              ];
              if (builtIn === undefined) return [];
              const projectId = candidate.projectId;
              return [
                {
                  environmentId: candidate.environmentId,
                  environmentLabel: candidate.label,
                  projectId,
                  builtIn,
                  projectText:
                    projectId === null
                      ? undefined
                      : candidate.settings.projectSettingsOverrides[projectId]
                          ?.agentRoleInstructions?.[row.role],
                  environmentText: environmentSettingsById.get(candidate.environmentId)
                    ?.agentRoleInstructions[row.role],
                },
              ];
            })
          : targets.flatMap((candidate) => {
              const builtIn = instructionDefaultsByEnvironment.get(candidate.environmentId)?.[
                row.role
              ];
              if (builtIn === undefined) return [];
              return [
                {
                  environmentId: candidate.environmentId,
                  environmentLabel: candidate.label,
                  projectId: null,
                  builtIn,
                  projectText: undefined,
                  environmentText: environmentSettingsById.get(candidate.environmentId)
                    ?.agentRoleInstructions[row.role],
                },
              ];
            });
        const instructionSupported =
          targets.length > 0 && instructionTargets.length === targets.length;

        return (
          <RoleRow
            key={row.role}
            role={row.role}
            title={row.title}
            description={row.description}
            selection={selection}
            mixed={mixed}
            sourceLabel={sourceLabel}
            showReset={showReset}
            settings={settings}
            providers={providers}
            entries={entries}
            environmentId={representative?.environmentId ?? null}
            environmentLabel={environmentLabel}
            modelDisabledReason={modelDisabledReason}
            instructionTargets={instructionSupported ? instructionTargets : null}
            instructionScopeKey={roleInstructionScopeKey({
              scopeKind: scope.kind,
              targets: instructionTargets,
            })}
            projectScope={isProjectScope}
            onChange={(next) => updateSettings({ agentRoleModels: { [row.role]: next } })}
            onReset={() => updateSettings({ agentRoleModels: { [row.role]: null } })}
          />
        );
      })}
      <div className="space-y-1 px-3 py-2.5 text-xs leading-normal text-muted-foreground sm:px-4">
        <p>
          These models and instructions apply to T3-managed delegated task work. Your own threads
          and a provider's own subagents don't use them.
        </p>
        <p>
          A review or test model does not run anything by itself. Worker check reports stay
          unverified until you review them.
        </p>
        <p>
          A conversation that is already running keeps its model. A delegated worker keeps the
          instructions it launched with; instruction changes apply from the next launch.
        </p>
        <p>
          All environments writes the same roles to each selected environment. It does not link
          them; a later change on one environment stays there.
        </p>
      </div>
    </SettingsSection>
  );
}
