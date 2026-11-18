import {
  type AgentRole,
  type AgentRoleDelegationMode,
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
import { RolesDiscussionButton } from "../RolesDiscussion";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { getDisplayModelName, type ModelEsque } from "../chat/providerIconUtils";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { RoleInstructionsEditor } from "./RoleInstructionsEditor";
import { roleInstructionScopeKey, type RoleInstructionTarget } from "./roleInstructions";
import {
  ROLE_DELEGATION_MODE_LABELS,
  roleDelegationModeState,
  type RoleDelegationModeState,
} from "./roleDelegationModes";
import { useSettingsScope } from "./SettingsScopeContext";
import { scopedDelegationModesSupported, scopedRolesUnsupportedLabels } from "./scopedSettings";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SETTINGS_PICKER_TRIGGER_INHERITED_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
  settingResetAriaLabel,
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

/** The name the picker would show for `selection`, or null when its options do not list it. */
function modelLabel(
  selection: ModelSelection | null,
  modelOptions: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): string | null {
  if (selection === null) return null;
  const option = (modelOptions.get(selection.instanceId) ?? []).find(
    (candidate) => candidate.slug === selection.model,
  );
  return option === undefined ? null : getDisplayModelName(option);
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

function RoleDelegationControl({
  title,
  state,
  onChange,
  onReset,
}: {
  readonly title: string;
  readonly state: RoleDelegationModeState;
  readonly onChange: (mode: AgentRoleDelegationMode) => void;
  readonly onReset: () => void;
}) {
  const disabled = state.disabledReason !== null;
  return (
    <div className="mt-3 flex flex-col gap-2 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Delegation</span>
        <ToggleGroup
          aria-label={`${title} delegation mode`}
          variant="segmented"
          disabled={disabled}
          value={state.value === null ? [] : [state.value]}
          onValueChange={([next]) => {
            if (next === "prefer" || next === "always") onChange(next);
          }}
        >
          {(Object.keys(ROLE_DELEGATION_MODE_LABELS) as AgentRoleDelegationMode[]).map((mode) => (
            <Toggle key={mode} value={mode} inherited={state.inherited}>
              {ROLE_DELEGATION_MODE_LABELS[mode]}
            </Toggle>
          ))}
        </ToggleGroup>
        {state.showReset ? (
          <SettingResetButton
            ariaLabel={settingResetAriaLabel(`${title} delegation`, state.resetTooltip)}
            tooltip={state.resetTooltip}
            disabled={state.resetDisabled}
            onClick={onReset}
          />
        ) : null}
      </div>
      {state.note === null ? null : (
        <p className="min-w-0 text-xs text-muted-foreground">{state.note}</p>
      )}
    </div>
  );
}

function RoleRow({
  role,
  title,
  description,
  selection,
  mixed,
  showReset,
  modelInherited,
  inheritedModel,
  settings,
  providers,
  entries,
  environmentId,
  environmentLabel,
  modelDisabledReason,
  delegationState,
  instructionTargets,
  instructionScopeKey,
  projectScope,
  onChange,
  onReset,
  onDelegationChange,
  onDelegationReset,
}: {
  readonly role: AgentRole;
  readonly title: string;
  readonly description: string;
  readonly selection: ModelSelection | null;
  readonly mixed: boolean;
  readonly showReset: boolean;
  /** The model comes from the environment, so the pickers read as inherited. */
  readonly modelInherited: boolean;
  /** What a project reset falls back to; null hides the name from its tooltip. */
  readonly inheritedModel: ModelSelection | null;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly environmentId: EnvironmentId | null;
  readonly environmentLabel: string;
  readonly modelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly delegationState: RoleDelegationModeState;
  /** Null hides the fold when a selected server cannot persist or advertise instructions. */
  readonly instructionTargets: ReadonlyArray<RoleInstructionTarget> | null;
  readonly instructionScopeKey: string;
  readonly projectScope: boolean;
  readonly onChange: (selection: ModelSelection) => void;
  readonly onReset: () => void;
  readonly onDelegationChange: (mode: AgentRoleDelegationMode) => void;
  readonly onDelegationReset: () => void;
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
    unavailableReason === null
      ? undefined
      : `${unavailableReason} Choose another model, or connect the provider.`;
  const triggerLabel = mixed
    ? "Mixed"
    : selection === null
      ? "Not set"
      : unavailableReason !== null
        ? `${selection.model} (Unavailable)`
        : null;
  const pickerTriggerClassName = modelInherited
    ? SETTINGS_PICKER_TRIGGER_INHERITED_CLASSNAME
    : SETTINGS_PICKER_TRIGGER_CLASSNAME;
  const inheritedModelName = modelLabel(inheritedModel, modelOptions);
  const resetTooltip = projectScope
    ? inheritedModelName === null
      ? "Reset to inherited value"
      : `Reset to inherited value (${inheritedModelName})`
    : "Reset model";

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
            ariaLabel={settingResetAriaLabel(`${title} model`, resetTooltip)}
            tooltip={resetTooltip}
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
              triggerClassName={pickerTriggerClassName}
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
                triggerClassName={pickerTriggerClassName}
                onModelOptionsChange={(options) =>
                  onChange(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        )
      }
    >
      <RoleDelegationControl
        title={title}
        state={delegationState}
        onChange={onDelegationChange}
        onReset={onDelegationReset}
      />
      {instructionTargets === null ? null : (
        <RoleInstructionsEditor
          key={`${role}:${instructionScopeKey}`}
          role={role}
          title={title}
          projectScope={projectScope}
          targets={instructionTargets}
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
  // An older server drops the key silently, so guard the whole row's mode control
  // rather than showing a choice that will not be stored.
  const delegationModesSupported =
    connectedEnvironments.length === 0 || scopedDelegationModesSupported(connectedEnvironments);
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

  const unsupportedRoleLabels = scopedRolesUnsupportedLabels(targets, connectedEnvironments);
  if (unsupportedRoleLabels.length > 0) {
    return (
      <SettingsSection
        id="roles-models"
        title="Roles & models"
        headerAction={<RolesDiscussionButton />}
      >
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Update T3 Code on {unsupportedRoleLabels.join(", ")} to set up roles.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      id="roles-models"
      title="Roles & models"
      headerAction={<RolesDiscussionButton />}
    >
      {AGENT_ROLE_ROWS.filter((row) => roleSupported(row.role)).map((row) => {
        const selections = targets.map((candidate) =>
          effectiveRole(candidate, environmentSettingsById, row.role),
        );
        const mixed =
          selections.length > 1 &&
          selections.some((selection) => !Equal.equals(selection, selections[0]));
        const selection = target ? effectiveRole(target, environmentSettingsById, row.role) : null;
        const inheritedSelections = targets.map((candidate) =>
          environmentRole(environmentSettingsById, candidate.environmentId, row.role),
        );
        const inheritedModel =
          inheritedSelections.length > 0 &&
          inheritedSelections.every((candidate) => Equal.equals(candidate, inheritedSelections[0]))
            ? (inheritedSelections[0] ?? null)
            : null;
        const modelInherited =
          isProjectScope &&
          selection !== null &&
          !mixed &&
          targets.every((candidate) => projectRole(candidate, row.role) === undefined);
        const showReset = isProjectScope
          ? targets.some((candidate) => projectRole(candidate, row.role) !== undefined)
          : targets.some(
              (candidate) =>
                environmentRole(environmentSettingsById, candidate.environmentId, row.role) !==
                undefined,
            );
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
        const delegationState = roleDelegationModeState({
          projectScope: isProjectScope,
          modesSupported: delegationModesSupported,
          targets: targets.map((candidate) => ({
            projectMode:
              candidate.projectId === null
                ? undefined
                : candidate.settings.projectSettingsOverrides[candidate.projectId]
                    ?.agentRoleDelegationModes?.[row.role],
            environmentMode: environmentSettingsById.get(candidate.environmentId)
              ?.agentRoleDelegationModes[row.role],
            hasModel: effectiveRole(candidate, environmentSettingsById, row.role) !== null,
          })),
        });

        return (
          <RoleRow
            key={row.role}
            role={row.role}
            title={row.title}
            description={row.description}
            selection={selection}
            mixed={mixed}
            showReset={showReset}
            modelInherited={modelInherited}
            inheritedModel={inheritedModel}
            settings={settings}
            providers={providers}
            entries={entries}
            environmentId={representative?.environmentId ?? null}
            environmentLabel={environmentLabel}
            modelDisabledReason={modelDisabledReason}
            delegationState={delegationState}
            instructionTargets={instructionSupported ? instructionTargets : null}
            instructionScopeKey={roleInstructionScopeKey({
              scopeKind: scope.kind,
              targets: instructionTargets,
            })}
            projectScope={isProjectScope}
            onChange={(next) => updateSettings({ agentRoleModels: { [row.role]: next } })}
            onReset={() => updateSettings({ agentRoleModels: { [row.role]: null } })}
            onDelegationChange={(mode) =>
              updateSettings({ agentRoleDelegationModes: { [row.role]: mode } })
            }
            onDelegationReset={() =>
              updateSettings({ agentRoleDelegationModes: { [row.role]: null } })
            }
          />
        );
      })}
      <div className="space-y-1 px-3 py-2.5 text-xs leading-normal text-muted-foreground sm:px-4">
        <p>
          These models, delegation modes, and instructions apply to T3-managed delegated task work.
          Your own threads and a provider's own subagents don't use them.
        </p>
        <p>
          A role is active only when it has a model. With no role models set, nothing changes; with
          one or more, T3-managed parents check these roles before doing the work. Prefer delegates
          substantial matching work and keeps small changes in the parent thread. Always delegates
          any matching work.
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
