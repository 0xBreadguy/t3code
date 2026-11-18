import { EventId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
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
          const message = {
            id: "original-message",
            createdBy: "user",
            creationSource: "web",
            threadId,
            runId: null,
            nodeId: null,
            role: "user",
            text: "The previous progress",
            attachments: [],
            streaming: false,
            createdAt: at,
            updatedAt: at,
          };
          const messageJson = yield* encodeJson(message);
          yield* sql`
          INSERT INTO orchestration_v2_projection_messages
            (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
          VALUES (${message.id}, ${threadId}, 'user', 0, ${at}, ${at}, ${messageJson})`;
        }).pipe(
          Effect.provide(
            ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath))),
          ),
        );
        const sourceSettings =
          '{"defaultAppearance":"dark","cloudSpeechCredentials":{"openai":"source-only"},"worktreesDirectory":"/original/worktrees"}';
        yield* fs.writeFileString(settingsPath, sourceSettings);
        yield* fs.writeFileString(
          path.join(sourceHome, "userdata", "environment-id"),
          "original-environment",
        );

        const result = yield* copySetup({ sourceHome, targetHome });
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
            ["The previous progress"],
          );
          assert.deepEqual(copied.runs, []);
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
});
