import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  resolveProviderInstanceEnabled,
  ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import * as Effect from "effect/Effect";
import {
  SETUP_COPY_DEFAULT_PROVIDER_IDS,
  parseSetupCopyProviderMappings,
  resolveSetupCopyProviders,
} from "./SetupCopyProviders.ts";

const instanceId = ProviderInstanceId.make;
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const codex = { instanceId: instanceId("codex"), model: "gpt-5.4" };
const settingsJson = JSON.stringify({
  defaultAppearance: "dark",
  favorites: [{ provider: "favorite-pi", model: "openai/gpt-5.4" }],
  providerModelPreferences: { "work-codex": { hiddenModels: ["old"], modelOrder: ["gpt-5.4"] } },
  providerInstances: {
    "work-codex": { driver: "codex", config: { homePath: "/private/home", token: "secret-token" } },
  },
  cloudSpeechCredentials: { openai: "another-secret" },
});

it("offers exactly the default provider instances reconstructed by a trial", () => {
  assert.sameMembers<string>(
    [...SETUP_COPY_DEFAULT_PROVIDER_IDS],
    BUILT_IN_DRIVERS.filter((driver) => driver.metadata.hasDefaultInstance !== false).map(
      (driver) => driver.driverKind,
    ),
  );
});

it.effect("keeps unconfigured standard provider selections directly usable", () =>
  Effect.gen(function* () {
    const resolved = yield* resolveSetupCopyProviders({ modelSelections: [codex] });
    assert.deepEqual(resolved.modelSelection(codex), codex);
    assert.deepEqual(resolved.preferences, {
      providerInstances: {},
      defaultAppearance: "",
      responseStreamingMode: "paragraph",
      favorites: null,
      providerModelPreferences: null,
    });
  }),
);

it.effect("requires replacements for custom selections in every retained reference", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      resolveSetupCopyProviders({
        settingsJson,
        modelSelections: [{ ...codex, instanceId: instanceId("project-only") }],
        instanceIds: [instanceId("thread-only")],
      }),
    );
    assert.equal(error.reason, "mapping-required");
    assert.sameMembers(
      [...error.instanceIds],
      ["project-only", "thread-only", "favorite-pi", "work-codex"],
    );
    assert.include(error.message, "--map-provider");
  }),
);

it.effect.each([
  { instance: { driver: "codex", config: { homePath: "/work-account" } } },
  {
    instance: {
      driver: "codex",
      environment: [{ name: "API_KEY", value: "secret", sensitive: true }],
    },
  },
  { instance: { driver: "codex", enabled: false } },
  { instance: { driver: "claudeAgent" } },
])(
  "requires acknowledgement before a configured standard provider uses trial defaults ($instance)",
  ({ instance }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveSetupCopyProviders({
          settingsJson: JSON.stringify({ providerInstances: { codex: instance } }),
          modelSelections: [codex],
        }),
      );
      assert.equal(error.reason, "mapping-required");
      assert.deepEqual(error.instanceIds, [instanceId("codex")]);
    }),
);

it.effect("accepts explicit same-driver replacements without copying provider configuration", () =>
  Effect.gen(function* () {
    const mappings = yield* parseSetupCopyProviderMappings([
      "work-codex=codex",
      "favorite-pi=pi",
      "project-only=cursor",
      "codex=codex",
    ]);
    const selection = {
      ...codex,
      instanceId: instanceId("work-codex"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const resolved = yield* resolveSetupCopyProviders({
      settingsJson,
      modelSelections: [selection, { ...codex, instanceId: instanceId("project-only") }, codex],
      mappings,
    });
    assert.deepEqual(resolved.modelSelection(selection), {
      ...selection,
      instanceId: instanceId("codex"),
    });
    assert.equal(resolved.instanceId(instanceId("project-only")), "cursor");
    assert.deepEqual(resolved.preferences.favorites, [
      { provider: instanceId("pi"), model: "openai/gpt-5.4" },
    ]);
    assert.deepEqual(resolved.preferences.providerModelPreferences, {
      [instanceId("codex")]: { hiddenModels: ["old"], modelOrder: ["gpt-5.4"] },
    });
    const json = JSON.stringify(resolved.preferences);
    assert.notInclude(json, "secret");
    assert.notInclude(json, "/private/home");
    assert.deepEqual(resolved.preferences.providerInstances, {
      [instanceId("pi")]: { driver: ProviderDriverKind.make("pi"), enabled: true },
      [instanceId("cursor")]: { driver: ProviderDriverKind.make("cursor"), enabled: true },
    });
  }),
);

it.effect("allows metadata-only default instances and explicit same-id default resets", () =>
  Effect.gen(function* () {
    const plain = yield* resolveSetupCopyProviders({
      settingsJson:
        '{"providerInstances":{"codex":{"driver":"codex","displayName":"My Codex","config":{}}}}',
      modelSelections: [codex],
    });
    assert.deepEqual(plain.modelSelection(codex), codex);
    const acknowledged = yield* resolveSetupCopyProviders({
      settingsJson:
        '{"providerInstances":{"codex":{"driver":"codex","config":{"homePath":"/custom"}}}}',
      modelSelections: [codex],
      mappings: { codex: instanceId("codex") },
    });
    assert.deepEqual(acknowledged.modelSelection(codex), codex);
  }),
);

it.effect.each([
  { values: ["work-codex"], reason: "invalid-mapping" },
  { values: ["work-codex=codex=cursor"], reason: "invalid-mapping" },
  { values: ["work-codex=unknown"], reason: "invalid-target" },
  { values: ["work-codex=acpRegistry"], reason: "invalid-target" },
  { values: ["work-codex=codex", "work-codex=cursor"], reason: "invalid-mapping" },
])("rejects invalid replacement arguments ($values)", ({ values, reason }) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(parseSetupCopyProviderMappings(values));
    assert.equal(error.reason, reason);
  }),
);

it.effect.each([
  { mappings: { missing: instanceId("codex") }, reason: "unknown-source" },
  { mappings: { codex: instanceId("missing") }, reason: "invalid-target" },
  { mappings: { codex: instanceId("claudeAgent") }, reason: "driver-mismatch" },
])("rejects invalid typed mappings ($reason)", ({ mappings, reason }) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      resolveSetupCopyProviders({ modelSelections: [codex], mappings }),
    );
    assert.equal(error.reason, reason);
  }),
);

it.effect("rejects conflicting preferences instead of overwriting them", () =>
  Effect.gen(function* () {
    const source = JSON.stringify({
      providerModelPreferences: {
        codex: { hiddenModels: ["a"], modelOrder: [] },
        alias: { hiddenModels: ["b"], modelOrder: [] },
      },
    });
    const error = yield* Effect.flip(
      resolveSetupCopyProviders({
        settingsJson: source,
        modelSelections: [],
        mappings: { alias: instanceId("codex") },
      }),
    );
    assert.equal(error.reason, "preference-collision");
    assert.deepEqual(error.instanceIds, [instanceId("codex")]);
    const identical = yield* resolveSetupCopyProviders({
      settingsJson: source.replace('["b"]', '["a"]'),
      modelSelections: [],
      mappings: { alias: instanceId("codex") },
    });
    assert.deepEqual(Object.keys(identical.preferences.providerModelPreferences ?? {}), ["codex"]);
  }),
);

it.effect.each([
  "not json",
  '{"providerInstances":{"alias":{"config":{}}}}',
  '{"favorites":"invalid"}',
])(
  "refuses unreadable source settings instead of forgetting provider requirements (%s)",
  (source) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveSetupCopyProviders({ settingsJson: source, modelSelections: [codex] }),
      );
      assert.equal(error.reason, "settings-unreadable");
    }),
);

it.effect(
  "requires explicit trial defaults for legacy provider settings unless modern settings supersede them",
  () =>
    Effect.gen(function* () {
      const legacySettingsJson = '{"providers":{"codex":{"homePath":"/legacy-work-account"}}}';
      const error = yield* Effect.flip(
        resolveSetupCopyProviders({ settingsJson: legacySettingsJson, modelSelections: [codex] }),
      );
      assert.equal(error.reason, "mapping-required");
      assert.deepEqual(error.instanceIds, [instanceId("codex")]);
      const acknowledged = yield* resolveSetupCopyProviders({
        settingsJson: legacySettingsJson,
        modelSelections: [codex],
        mappings: { codex: instanceId("codex") },
      });
      assert.deepEqual(acknowledged.modelSelection(codex), codex);
      assert.notInclude(JSON.stringify(acknowledged.preferences), "legacy-work-account");
      const superseded = yield* resolveSetupCopyProviders({
        settingsJson:
          '{"providers":{"codex":{"homePath":"/legacy-work-account"}},"providerInstances":{"codex":{"driver":"codex"}}}',
        modelSelections: [codex],
      });
      assert.deepEqual(superseded.modelSelection(codex), codex);
    }),
);

it.effect.each([
  {
    selections: [{ instanceId: instanceId("grok"), model: "grok-build" }],
    settings: { providerInstances: { grok: { driver: "grok", enabled: true } } },
  },
  { selections: [], settings: { favorites: [{ provider: "grok", model: "grok-build" }] } },
  {
    selections: [{ instanceId: instanceId("grok"), model: "grok-build" }],
    settings: {
      projectSettingsOverrides: { project: { providerInstances: { grok: { enabled: true } } } },
    },
  },
])(
  "requires an explicit choice before enabling default-disabled copied providers ($settings)",
  ({ selections, settings }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveSetupCopyProviders({
          settingsJson: JSON.stringify(settings),
          modelSelections: selections,
        }),
      );
      assert.equal(error.reason, "mapping-required");
      assert.deepEqual(error.instanceIds, [instanceId("grok")]);
    }),
);

it.effect.each(["grok", "work-grok"])(
  "enables an explicitly chosen trial provider without copying source config (%s)",
  (source) =>
    Effect.gen(function* () {
      const resolved = yield* resolveSetupCopyProviders({
        settingsJson: JSON.stringify({
          providerInstances: { [source]: { driver: "grok", enabled: true } },
        }),
        modelSelections: [{ instanceId: instanceId(source), model: "grok-build" }],
        mappings: { [source]: instanceId("grok") },
      });
      const copied = decodeServerSettings(resolved.preferences);
      const instance = copied.providerInstances[instanceId("grok")];
      assert.isDefined(instance);
      assert.isTrue(resolveProviderInstanceEnabled(instance!));
      assert.deepEqual(instance, { driver: ProviderDriverKind.make("grok"), enabled: true });
    }),
);
