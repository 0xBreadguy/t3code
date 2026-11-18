import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import { importedMessageEvents } from "../orchestration-v2/importedMessageEvents.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { copySetup } from "./SetupCopy.ts";
import * as SqlitePersistence from "./Sqlite.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

it.layer(NodeServices.layer)("trial setup copy", (it) => {
  it.effect(
    "copies reference history while leaving source workspaces and runtime state behind",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-setup-copy-" });
        const sourceHome = path.join(root, "original");
        const targetHome = path.join(root, "trial");
        const workspaceRoot = path.join(root, "repo");
        const dbPath = path.join(sourceHome, "userdata", "statev2.sqlite");
        const settingsPath = path.join(sourceHome, "userdata", "settings.json");
        const projectId = ProjectId.make("copy-project");
        const threadId = ThreadId.make("original-thread");
        const instanceId = ProviderInstanceId.make("codex");
        const modelSelection = { instanceId, model: "gpt-5.4" };
        const at = "2026-10-01T12:00:00.000Z";
        const branch = "original-branch";
        const worktreePath = path.join(root, branch);

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const projectStore = yield* ProjectStore.ProjectStoreV2;
          yield* projectStore.apply({
            sequence: 0,
            eventId: EventId.make("create-project"),
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
              title: "Original project",
              workspaceRoot,
              defaultModelSelection: modelSelection,
              defaultThreadEnvMode: "local",
              scripts: [],
              createdAt: at,
              updatedAt: at,
            },
          });
          const thread = {
            id: threadId,
            projectId,
            title: "Original conversation",
            createdBy: "user",
            creationSource: "web",
            providerInstanceId: instanceId,
            modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch,
            worktreePath,
            activeProviderThreadId: "provider-thread",
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: at,
            updatedAt: at,
            archivedAt: null,
            deletedAt: null,
          };
          const threadJson = yield* encodeJson(thread);
          yield* sql`
          INSERT INTO orchestration_v2_projection_threads
            (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
          VALUES (${threadId}, ${projectId}, ${thread.title}, ${instanceId}, 'approval-required', 'default', ${at}, ${at}, ${threadJson})`;
          const projection = yield* ProjectionStore.ProjectionStoreV2;
          const runId = RunId.make("rolled-back-run");
          const run = {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: "hidden-user",
            rootNodeId: "old-root",
            activeAttemptId: null,
            status: "rolled_back",
            requestedAt: at,
            startedAt: at,
            completedAt: at,
            checkpointId: null,
            contextHandoffId: null,
          };
          yield* sql`INSERT INTO orchestration_v2_projection_runs
            (run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json)
            VALUES (${runId}, ${threadId}, 1, ${instanceId}, NULL, 'rolled_back', ${at}, ${at}, ${yield* encodeJson(run)})`;
          const messages = [
            {
              id: MessageId.make("z-user"),
              role: "user" as const,
              text: "The previous progress",
              runId: null,
            },
            {
              id: MessageId.make("hidden-user"),
              role: "user" as const,
              text: "Discarded instruction",
              runId,
            },
            {
              id: MessageId.make("a-assistant"),
              role: "assistant" as const,
              text: "The answer",
              runId: null,
            },
          ];
          for (const [index, message] of messages.entries()) {
            for (const event of importedMessageEvents({
              eventPrefix: "source",
              threadId,
              index,
              message: { ...message, createdAt: at },
            })) {
              if (event.type === "message.updated") {
                yield* projection.apply({
                  ...event,
                  payload: { ...event.payload, id: message.id, runId: message.runId },
                });
              } else if (
                event.type === "turn-item.updated" &&
                (event.payload.type === "user_message" ||
                  event.payload.type === "assistant_message")
              ) {
                yield* projection.apply({
                  ...event,
                  payload: { ...event.payload, messageId: message.id, runId: message.runId },
                });
              }
            }
          }
          const visible = yield* projection.getTimelinePage(threadId, {
            view: "messages",
            limit: 10,
          });
          assert.deepEqual(
            visible.items.map(({ item }) => ("text" in item ? item.text : null)),
            ["The previous progress", "The answer"],
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer).pipe(
              Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
            ),
          ),
        );
        const sourceSettings =
          '{"defaultAppearance":"dark","cloudSpeechCredentials":{"openai":"source-only"},"worktreesDirectory":"/original/worktrees"}';
        yield* fs.writeFileString(settingsPath, sourceSettings);
        yield* fs.writeFileString(
          path.join(sourceHome, "userdata", "environment-id"),
          "original-environment",
        );

        const sourceDatabase = yield* fs.readFile(dbPath);
        const result = yield* copySetup({ sourceHome, targetHome });
        assert.deepEqual(yield* fs.readFile(dbPath), sourceDatabase);
        assert.deepEqual(result, { projects: 1, threads: 1 });
        const targetState = path.join(targetHome, "userdata");
        assert.deepEqual((yield* fs.readDirectory(targetState)).sort(), [
          "settings.json",
          "statev2.sqlite",
        ]);
        const settings = yield* fs.readFileString(path.join(targetState, "settings.json"));
        assert.include(settings, '"defaultAppearance":"dark"');
        assert.include(settings, '"defaultThreadEnvMode":"worktree"');
        assert.notInclude(settings, "source-only");
        assert.notInclude(settings, "/original/worktrees");
        assert.equal(yield* fs.readFileString(settingsPath), sourceSettings);

        const copiedId = ThreadId.make("setup-copy-original-thread");
        const targetLayer = SqlitePersistence.layerFromPath(
          path.join(targetState, "statev2.sqlite"),
        );
        yield* Effect.gen(function* () {
          const projects = yield* ProjectStore.ProjectStoreV2;
          const projection = yield* ProjectionStore.ProjectionStoreV2;
          const [project] = yield* projects.list();
          assert.equal(project?.workspaceRoot, workspaceRoot);
          assert.equal(project?.projectId, "setup-copy-copy-project");
          const copied = yield* projection.getThreadRecords(copiedId, ["messages", "runs"]);
          assert.equal(copied.thread.title, "Original conversation");
          assert.equal(copied.thread.projectId, project?.projectId);
          assert.isNull(copied.thread.worktreePath);
          assert.isNull(copied.thread.activeProviderThreadId);
          assert.deepEqual(
            copied.messages.map((message) => message.text),
            ["The previous progress", "The answer"],
          );
          assert.deepEqual(copied.runs, []);
          const timeline = yield* projection.getTimelinePage(copiedId, {
            view: "messages",
            limit: 10,
          });
          assert.deepEqual(
            timeline.items.map(({ item }) => ("text" in item ? item.text : null)),
            ["The previous progress", "The answer"],
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer).pipe(
              Layer.provide(targetLayer),
            ),
          ),
        );
        for (const occupiedHome of [targetHome, sourceHome, path.join(sourceHome, "nested")]) {
          const retry = yield* Effect.flip(copySetup({ sourceHome, targetHome: occupiedHome }));
          assert.equal(retry._tag, "SetupCopyError");
        }
      }),
  );

  it.effect.each([false, true])(
    "refuses incomplete legacy history before publishing trial state (shell imported: %s)",
    (shellImported) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-setup-copy-legacy-" });
        const sourceHome = path.join(root, "original");
        const targetHome = path.join(root, "trial");
        const dbPath = path.join(sourceHome, "userdata", "statev2.sqlite");
        const db = SqlitePersistence.layerFromPath(dbPath);
        const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
          Layer.provideMerge(db),
        );
        const sink = EventSink.layer.pipe(Layer.provideMerge(stores));
        const importerLayer = LegacyV1ThreadImporter.layer.pipe(Layer.provideMerge(sink));
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
          yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, created_at, updated_at)
          VALUES ('legacy-project', 'Legacy project', '/tmp/repo', '[]',
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
          yield* sql`INSERT INTO projection_threads
          (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
          VALUES ('legacy-thread', 'legacy-project', 'Legacy conversation',
            '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default',
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
          yield* sql`INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
          VALUES ('old', 'legacy-thread', 'user', 'Old question', 0,
            '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z'),
            ('latest', 'legacy-thread', 'user', 'Latest question', 0,
            '2026-01-02T01:00:00.000Z', '2026-01-02T01:00:00.000Z')`;
          if (shellImported) yield* importer.reconcileShells;
          assert.equal(yield* importer.pendingThreadCount, 1);
        }).pipe(Effect.provide(importerLayer));
        const settingsPath = path.join(sourceHome, "userdata", "settings.json");
        const settings = '{"defaultAppearance":"dark"}';
        yield* fs.writeFileString(settingsPath, settings);
        const before = yield* fs.readFile(dbPath);
        const error = yield* Effect.flip(copySetup({ sourceHome, targetHome }));
        assert.equal(error._tag, "SetupCopyPendingLegacyError");
        assert.include(error.message, "finish");
        assert.equal(yield* fs.exists(path.join(targetHome, "userdata")), false);
        assert.deepEqual(yield* fs.readFile(dbPath), before);
        assert.equal(yield* fs.readFileString(settingsPath), settings);
        yield* Effect.gen(function* () {
          const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
          yield* importer.reconcileShells;
          yield* importer.ensureTranscript(ThreadId.make("legacy-thread"));
        }).pipe(Effect.provide(importerLayer));
        assert.deepEqual(yield* copySetup({ sourceHome, targetHome }), { projects: 1, threads: 1 });
        yield* Effect.gen(function* () {
          const projection = yield* ProjectionStore.ProjectionStoreV2;
          const timeline = yield* projection.getTimelinePage(
            ThreadId.make("setup-copy-legacy-thread"),
            { view: "messages", limit: 10 },
          );
          assert.deepEqual(
            timeline.items.map(({ item }) => ("text" in item ? item.text : null)),
            ["Old question", "Latest question"],
          );
        }).pipe(
          Effect.provide(
            ProjectionStore.layer.pipe(
              Layer.provide(
                SqlitePersistence.layerFromPath(
                  path.join(targetHome, "userdata", "statev2.sqlite"),
                ),
              ),
            ),
          ),
        );
      }),
  );
});
