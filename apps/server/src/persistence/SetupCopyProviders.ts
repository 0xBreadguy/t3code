import {
  ProviderInstanceId,
  ProviderDriverKind,
  isUnconfiguredDefaultInstanceEnabled,
  defaultInstanceIdForDriver,
  ServerSettings,
  type ModelSelection,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const SETUP_COPY_DEFAULT_PROVIDER_IDS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "fx",
  "opencode",
  "antigravity",
  "kiro",
  "pi",
  "muse",
] as const;
const trialProviderIds = new Set<string>(SETUP_COPY_DEFAULT_PROVIDER_IDS);

export type SetupCopyProviderMappings = Readonly<Record<string, ProviderInstanceId>>;

export class SetupCopyProviderError extends Schema.TaggedError<SetupCopyProviderError>()(
  "SetupCopyProviderError",
  {
    reason: Schema.Literals([
      "settings-unreadable",
      "invalid-mapping",
      "invalid-target",
      "unknown-source",
      "mapping-required",
      "preference-collision",
      "driver-mismatch",
    ]),
    instanceIds: Schema.Array(ProviderInstanceId),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const ids = this.instanceIds.join(", ");
    switch (this.reason) {
      case "settings-unreadable":
        return "The source provider settings could not be read. Repair the source settings before copying the setup.";
      case "invalid-mapping":
        return "Use --map-provider source=destination once for each provider replacement. A source can have only one destination.";
      case "invalid-target":
        return `Provider replacements must use a standard trial provider: ${[...trialProviderIds].join(", ")}.`;
      case "unknown-source":
        return `These provider mappings do not match any copied selection: ${ids}. Remove or correct them before retrying.`;
      case "mapping-required":
        return `Choose a standard trial provider explicitly for these saved selections: ${ids}. Retry with --map-provider source=destination for each one. Mapping a standard provider to itself chooses its trial defaults and enables it.`;
      case "preference-collision":
        return `Provider model preferences would conflict after mapping to ${ids}. Reconcile those preferences in the source setup before retrying.`;
      case "driver-mismatch":
        return `These provider replacements use a different driver: ${ids}. Choose a standard provider with the source instance's driver. If that driver has no standard instance, switch the saved selections to a supported provider in the source setup before retrying.`;
    }
  }
}

const decodeInstanceId = Schema.decodeUnknownEffect(ProviderInstanceId);

export const parseSetupCopyProviderMappings = Effect.fn("SetupCopyProviders.parseMappings")(
  function* (values: ReadonlyArray<string>) {
    const mappings: Record<string, ProviderInstanceId> = {};
    for (const value of values) {
      const parts = value.split("=");
      if (parts.length !== 2) {
        return yield* new SetupCopyProviderError({ reason: "invalid-mapping", instanceIds: [] });
      }
      const source = yield* decodeInstanceId(parts[0]?.trim()).pipe(
        Effect.mapError(
          (cause) =>
            new SetupCopyProviderError({ reason: "invalid-mapping", instanceIds: [], cause }),
        ),
      );
      const destination = yield* decodeInstanceId(parts[1]?.trim()).pipe(
        Effect.mapError(
          (cause) =>
            new SetupCopyProviderError({ reason: "invalid-mapping", instanceIds: [], cause }),
        ),
      );
      if (!trialProviderIds.has(destination)) {
        return yield* new SetupCopyProviderError({ reason: "invalid-target", instanceIds: [] });
      }
      if (Object.hasOwn(mappings, source) && mappings[source] !== destination) {
        return yield* new SetupCopyProviderError({
          reason: "invalid-mapping",
          instanceIds: [source],
        });
      }
      mappings[source] = destination;
    }
    return mappings;
  },
);

const sourceSettings = Schema.Struct({
  defaultAppearance: ServerSettings.fields.defaultAppearance,
  favorites: ServerSettings.fields.favorites,
  responseStreamingMode: ServerSettings.fields.responseStreamingMode,
  providerModelPreferences: ServerSettings.fields.providerModelPreferences,
  providerInstances: ServerSettings.fields.providerInstances,
  providers: Schema.Record(Schema.String, Schema.Unknown).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
const decodeSettings = Schema.decodeEffect(fromLenientJson(sourceSettings));

const legacyProviderSettings = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;

const omittedProviderSettings = (id: ProviderInstanceId, instance: ProviderInstanceConfig) =>
  defaultInstanceIdForDriver(instance.driver) !== id ||
  instance.enabled === false ||
  (instance.environment?.length ?? 0) > 0 ||
  (instance.config !== undefined &&
    (instance.config === null ||
      typeof instance.config !== "object" ||
      Object.keys(instance.config).length > 0));

export const resolveSetupCopyProviders = Effect.fn("SetupCopyProviders.resolve")(function* (input: {
  readonly settingsJson?: string;
  readonly modelSelections: ReadonlyArray<ModelSelection>;
  readonly instanceIds?: ReadonlyArray<ProviderInstanceId>;
  readonly mappings?: SetupCopyProviderMappings;
}) {
  const settings = yield* decodeSettings(input.settingsJson ?? "{}").pipe(
    Effect.mapError(
      (cause) =>
        new SetupCopyProviderError({ reason: "settings-unreadable", instanceIds: [], cause }),
    ),
  );
  const mappings = input.mappings ?? {};
  const referenced = new Set([
    ...input.modelSelections.map((selection) => selection.instanceId),
    ...(input.instanceIds ?? []),
    ...(settings.favorites?.map((favorite) => favorite.provider) ?? []),
    ...Object.keys(settings.providerModelPreferences ?? {}).map((id) =>
      ProviderInstanceId.make(id),
    ),
  ]);
  for (const [rawSource, destination] of Object.entries(mappings)) {
    const source = yield* decodeInstanceId(rawSource).pipe(
      Effect.mapError(
        (cause) =>
          new SetupCopyProviderError({ reason: "invalid-mapping", instanceIds: [], cause }),
      ),
    );
    if (!trialProviderIds.has(destination)) {
      return yield* new SetupCopyProviderError({ reason: "invalid-target", instanceIds: [] });
    }
    if (!referenced.has(source)) {
      return yield* new SetupCopyProviderError({ reason: "unknown-source", instanceIds: [source] });
    }
    const driver = settings.providerInstances[source]?.driver;
    const defaultInstanceId =
      driver === undefined
        ? trialProviderIds.has(source) ||
          legacyProviderSettings(settings.providers[source]) !== undefined
          ? source
          : undefined
        : defaultInstanceIdForDriver(driver);
    if (defaultInstanceId !== undefined && defaultInstanceId !== destination) {
      return yield* new SetupCopyProviderError({
        reason: "driver-mismatch",
        instanceIds: [source],
      });
    }
  }
  const missing = [...referenced].filter((id) => {
    if (Object.hasOwn(mappings, id)) return false;
    const instance = settings.providerInstances[id];
    return (
      !trialProviderIds.has(id) ||
      !isUnconfiguredDefaultInstanceEnabled(id) ||
      (instance !== undefined
        ? omittedProviderSettings(id, instance)
        : Object.keys(legacyProviderSettings(settings.providers[id]) ?? {}).length > 0)
    );
  });
  if (missing.length > 0) {
    return yield* new SetupCopyProviderError({ reason: "mapping-required", instanceIds: missing });
  }
  const instanceId = (id: ProviderInstanceId) => (Object.hasOwn(mappings, id) ? mappings[id]! : id);
  const modelSelection = (selection: ModelSelection): ModelSelection => ({
    ...selection,
    instanceId: instanceId(selection.instanceId),
  });
  const providerModelPreferences: Record<
    ProviderInstanceId,
    NonNullable<typeof settings.providerModelPreferences>[ProviderInstanceId]
  > = {};
  for (const [source, preferences] of Object.entries(settings.providerModelPreferences ?? {})) {
    const destination = instanceId(ProviderInstanceId.make(source));
    const existing = Object.hasOwn(providerModelPreferences, destination)
      ? providerModelPreferences[destination]
      : undefined;
    if (
      existing !== undefined &&
      (existing.hiddenModels.length !== preferences.hiddenModels.length ||
        existing.hiddenModels.some((model, index) => model !== preferences.hiddenModels[index]) ||
        existing.modelOrder.length !== preferences.modelOrder.length ||
        existing.modelOrder.some((model, index) => model !== preferences.modelOrder[index]))
    ) {
      return yield* new SetupCopyProviderError({
        reason: "preference-collision",
        instanceIds: [destination],
      });
    }
    providerModelPreferences[destination] = preferences;
  }
  const favorites =
    settings.favorites?.map((favorite) => ({
      ...favorite,
      provider: instanceId(favorite.provider),
    })) ?? null;
  const providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig> = {};
  for (const destination of new Set(Object.values(mappings))) {
    if (isUnconfiguredDefaultInstanceEnabled(destination)) continue;
    providerInstances[destination] = {
      driver: ProviderDriverKind.make(destination),
      enabled: true,
    };
  }
  return {
    instanceId,
    modelSelection,
    preferences: {
      providerInstances,
      defaultAppearance: settings.defaultAppearance,
      responseStreamingMode: settings.responseStreamingMode,
      favorites:
        favorites?.filter(
          (favorite, index) =>
            favorites.findIndex(
              (candidate) =>
                candidate.provider === favorite.provider && candidate.model === favorite.model,
            ) === index,
        ) ?? null,
      providerModelPreferences:
        settings.providerModelPreferences === null ? null : providerModelPreferences,
    },
  };
});
