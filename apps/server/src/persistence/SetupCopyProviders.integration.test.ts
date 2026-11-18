import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { copySetup } from "./SetupCopy.ts";
import * as SqlitePersistence from "./Sqlite.ts";

const threadProvider = ProviderInstanceId.make("work-codex");
const projectProvider = ProviderInstanceId.make("project-claude");
const favoriteProvider = ProviderInstanceId.make("favorite-pi");
const projectId = ProjectId.make("provider-project");
const threadId = ThreadId.make("provider-thread");
const at = "2026-10-01T12:00:00.000Z";
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSettings = Schema.decodeEffect(Schema.fromJsonString(ServerSettings));

const sourceFixture = Effect.fn("SetupCopyProvidersTest.sourceFixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "setup-copy-providers-" });
  const sourceHome = path.join(root, "source");
  const targetHome = path.join(root, "trial");
  const dbPath = path.join(sourceHome, "userdata", "statev2.sqlite");
  const settingsPath = path.join(sourceHome, "userdata", "settings.json");
  yield* Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const projection = yield* ProjectionStore.ProjectionStoreV2;
    yield* projects.apply({
      sequence: 0,
      eventId: EventId.make("provider-project-created"),
      type: "project.created",
      aggregateKind: "project",
      aggregateId: projectId,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      occurredAt: at,
      payload: {
        projectId,
        title: "Provider project",
        workspaceRoot: path.join(root, "repo"),
        defaultModelSelection: { instanceId: projectProvider, model: "claude-opus-4-6" },
        scripts: [],
        createdAt: at,
        updatedAt: at,
      },
    });
    yield* projection.apply({
      id: EventId.make("provider-thread-created"),
      type: "thread.created",
      threadId,
      occurredAt: DateTime.makeUnsafe(at),
      payload: {
        id: threadId,
        projectId,
        title: "Provider conversation",
        createdBy: "user",
        creationSource: "web",
        providerInstanceId: threadProvider,
        modelSelection: { instanceId: threadProvider, model: "gpt-5.4" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: DateTime.makeUnsafe(at),
        updatedAt: DateTime.makeUnsafe(at),
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer).pipe(
        Layer.provide(SqlitePersistence.layerFromPath(dbPath)),
      ),
    ),
  );
  const settingsJson = yield* encodeJson({
    defaultAppearance: "dark",
    providerInstances: {
      [threadProvider]: {
        driver: "codex",
        displayName: "Work Codex",
        environment: [{ name: "API_KEY", value: "source-secret", sensitive: true }],
        config: { homePath: "/source/account", apiKey: "source-secret" },
      },
      [projectProvider]: { driver: "claudeAgent" },
    },
    favorites: [{ provider: favoriteProvider, model: "favorite-model" }],
    providerModelPreferences: {
      [threadProvider]: { hiddenModels: ["hidden-model"], modelOrder: ["gpt-5.4"] },
    },
  });
  yield* fs.writeFileString(settingsPath, settingsJson);
  const databaseBefore = yield* fs.readFile(dbPath);
  return { sourceHome, targetHome, dbPath, settingsPath, settingsJson, databaseBefore };
});

it.layer(NodeServices.layer)("trial provider resolution", (it) => {
  it.effect(
    "refuses unresolved provider references without publishing or changing the source",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* sourceFixture();
        const result = yield* Effect.result(copySetup(fixture));
        assert.equal(result._tag, "Failure");
        assert.isFalse(yield* fs.exists(path.join(fixture.targetHome, "userdata")));
        assert.equal(yield* fs.readFileString(fixture.settingsPath), fixture.settingsJson);
        assert.deepEqual(yield* fs.readFile(fixture.dbPath), fixture.databaseBefore);
      }),
  );

  it.effect(
    "resolves retained provider references together while excluding source credentials",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* sourceFixture();
        const result = yield* copySetup({
          ...fixture,
          providerMappings: {
            [threadProvider]: ProviderInstanceId.make("codex"),
            [projectProvider]: ProviderInstanceId.make("claudeAgent"),
            [favoriteProvider]: ProviderInstanceId.make("pi"),
          },
        });
        assert.deepEqual(result, { projects: 1, threads: 1 });
        const targetState = path.join(fixture.targetHome, "userdata");
        const settingsJson = yield* fs.readFileString(path.join(targetState, "settings.json"));
        const settings = yield* decodeSettings(settingsJson);
        assert.deepEqual(settings.favorites, [
          { provider: ProviderInstanceId.make("pi"), model: "favorite-model" },
        ]);
        assert.deepEqual(settings.providerModelPreferences, {
          [ProviderInstanceId.make("codex")]: {
            hiddenModels: ["hidden-model"],
            modelOrder: ["gpt-5.4"],
          },
        });
        const pi = ProviderInstanceId.make("pi");
        assert.deepEqual(settings.providerInstances, {
          [pi]: { driver: ProviderDriverKind.make("pi"), enabled: true },
        });
        assert.isTrue(
          resolveProviderInstanceEnabled(
            settings.providerInstances[pi] ?? { driver: ProviderDriverKind.make("pi") },
          ),
        );
        assert.notInclude(settingsJson, "source-secret");
        assert.notInclude(settingsJson, "/source/account");
        yield* Effect.gen(function* () {
          const projects = yield* ProjectStore.ProjectStoreV2;
          const projection = yield* ProjectionStore.ProjectionStoreV2;
          assert.equal(
            (yield* projects.list())[0]?.defaultModelSelection?.instanceId,
            "claudeAgent",
          );
          const copied = yield* projection.getThreadRecords(
            ThreadId.make("setup-copy-provider-thread"),
            [],
          );
          assert.equal(copied.thread.providerInstanceId, "codex");
          assert.equal(copied.thread.modelSelection.instanceId, "codex");
        }).pipe(
          Effect.provide(
            Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer).pipe(
              Layer.provide(
                SqlitePersistence.layerFromPath(path.join(targetState, "statev2.sqlite")),
              ),
            ),
          ),
        );
        assert.equal(yield* fs.readFileString(fixture.settingsPath), fixture.settingsJson);
        assert.deepEqual(yield* fs.readFile(fixture.dbPath), fixture.databaseBefore);
      }),
  );
});
