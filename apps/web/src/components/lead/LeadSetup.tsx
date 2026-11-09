import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import type { LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { createModelSelection } from "@t3tools/shared/model";
import { useState } from "react";

import { useMergedSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useLeadBackend } from "../../rpc/lead";
import { useEnvironment, useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { randomUUID } from "../../lib/utils";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";

/**
 * The one setup action for a project that has no lead conversation. It starts
 * the lead with the model the user picks; it never substitutes a model when
 * send would fail for a missing one.
 */
export function LeadSetup({
  scope,
  data,
  projectLabel,
  canOperate,
  onChanged,
}: {
  readonly scope: LeadScope;
  readonly data: LeadReadResult;
  readonly projectLabel: string;
  readonly canOperate: boolean;
  readonly onChanged: () => void;
}) {
  const backend = useLeadBackend();
  const environment = useEnvironment(scope.environmentId);
  const providersByEnvironment = useEnvironmentProviders();
  const settings = useMergedSettings(
    environment?.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
  );
  const providers = providersByEnvironment.get(scope.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, scope.projectId);
  const roleModel = data.roleModels.lead ?? null;
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = picked ?? roleModel;
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId ?? null,
    selection?.model ?? null,
  );
  const activeInstanceId =
    selection?.instanceId ??
    entries.find((candidate) => candidate.enabled && candidate.isAvailable)?.instanceId ??
    entries[0]?.instanceId ??
    null;
  const entry =
    selection === null
      ? undefined
      : entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const unavailableReason =
    selection === null
      ? null
      : entry === undefined
        ? `${selection.instanceId} is not configured on this environment.`
        : !entry.enabled
          ? `${entry.displayName} is disabled on this environment.`
          : !entry.isAvailable
            ? `${entry.displayName} is unavailable on this environment.`
            : (() => {
                const option = (modelOptions.get(selection.instanceId) ?? []).find(
                  (candidate) => candidate.slug === selection.model,
                );
                if (option === undefined)
                  return `${selection.model} is not offered by ${entry.displayName}.`;
                if (option.isUnavailable) return `${selection.model} is unavailable here.`;
                return null;
              })();
  const canStart = selection !== null && unavailableReason === null && canOperate && !busy;

  const start = async () => {
    if (!canStart || selection === null) return;
    setBusy(true);
    setError(null);
    const failure = await backend
      .ensure(scope.environmentId, {
        projectId: scope.projectId,
        requestId: randomUUID(),
        modelSelection: selection,
      })
      .then(() => null)
      .catch((startError: unknown) =>
        startError instanceof Error ? startError : new Error("Couldn't start the lead."),
      );
    if (failure === null) onChanged();
    else setError(failure.message);
    setBusy(false);
  };

  return (
    <div className="space-y-2 border-b border-border/70 bg-muted/20 px-3 py-2" data-lead-setup="">
      <div>
        <p className="text-xs font-medium text-foreground">Set up the {projectLabel} lead</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          {roleModel === null
            ? "This project has no lead model yet. Choose one to start the lead."
            : `It starts as ${roleModel.model} · ${roleModel.instanceId} and keeps that model.`}
        </p>
      </div>
      {activeInstanceId === null ? (
        <p className="text-2xs text-muted-foreground">
          No providers are available on this environment. Connect one first.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <ProviderModelPicker
            environmentId={scope.environmentId}
            activeInstanceId={activeInstanceId}
            model={selection?.model ?? ""}
            lockedProvider={null}
            instanceEntries={entries}
            modelOptionsByInstance={modelOptions}
            triggerClassName="max-w-56"
            triggerAriaLabel={`${projectLabel} lead model`}
            {...(selection === null
              ? { triggerLabel: "Choose model" }
              : unavailableReason !== null
                ? { triggerLabel: `${selection.model} (Unavailable)` }
                : {})}
            getModelDisabledReason={(instanceId: ProviderInstanceId, model: string) => {
              const candidate = entries.find((option) => option.instanceId === instanceId);
              if (candidate === undefined) return "This provider is not configured here.";
              if (!candidate.enabled) return "This provider is disabled here.";
              if (!candidate.isAvailable) return "This provider is unavailable here.";
              const option = (modelOptions.get(instanceId) ?? []).find(
                (modelOption) => modelOption.slug === model,
              );
              if (option === undefined) return "This provider does not offer that model.";
              if (option.isUnavailable) return "This model is unavailable here.";
              return null;
            }}
            onInstanceModelChange={(instanceId, model) =>
              setPicked(createModelSelection(instanceId, model))
            }
          />
          {selection !== null && entry !== undefined ? (
            <TraitsPicker
              provider={entry.driverKind}
              models={entry.models}
              model={selection.model}
              modelOptions={selection.options ?? []}
              allowPromptInjectedEffort={false}
              onModelOptionsChange={(options) =>
                setPicked(createModelSelection(selection.instanceId, selection.model, options))
              }
            />
          ) : null}
          <Button size="xs" disabled={!canStart} onClick={() => void start()}>
            {busy ? "Starting…" : "Start the lead"}
          </Button>
        </div>
      )}
      {unavailableReason !== null ? (
        <p className="text-2xs text-destructive-foreground">
          {unavailableReason} Choose another model or connect the provider.
        </p>
      ) : null}
      {!canOperate ? (
        <p className="text-2xs text-destructive-foreground">
          You don't have permission to start work on this environment.
        </p>
      ) : null}
      {error !== null ? <p className="text-2xs text-destructive-foreground">{error}</p> : null}
    </div>
  );
}
