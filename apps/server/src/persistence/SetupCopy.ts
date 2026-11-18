import {
  EventId,
  ModelSelection,
  ProjectId,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  ServerSettings,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { importedMessageEvents } from "../orchestration-v2/importedMessageEvents.ts";
import {
  SETUP_COPY_PROJECT_PREFIX,
  SETUP_COPY_THREAD_PREFIX,
} from "../orchestration-v2/trialWorkspace.ts";
import * as OrchestrationEventStore from "./OrchestrationEventStore.ts";
import * as SqlitePersistence from "./Sqlite.ts";

export class SetupCopyError extends Schema.TaggedError<SetupCopyError>()("SetupCopyError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const decodeThread = Schema.decodeEffect(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const decodeMessage = Schema.decodeEffect(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);
const trialDefaults = {
  defaultThreadEnvMode: "worktree",
  newWorktreesStartFromOrigin: false,
} as const;
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodePreferences = Schema.decodeEffect(
  fromLenientJson(
    Schema.Struct({
      defaultAppearance: ServerSettings.fields.defaultAppearance,
      favorites: ServerSettings.fields.favorites,
      responseStreamingMode: ServerSettings.fields.responseStreamingMode,
      providerModelPreferences: ServerSettings.fields.providerModelPreferences,
    }),
  ),
);

const decodeProject = Schema.decodeUnknownEffect(
  Schema.Struct({
    projectId: ProjectId,
    title: Schema.String,
    workspaceRoot: Schema.String,
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    createdAt: Schema.String,
    updatedAt: Schema.String,
    archivedAt: Schema.NullOr(Schema.String),
    pinnedAt: Schema.NullOr(Schema.String),
  }),
);

const readSource = Effect.fn("SetupCopy.readSource")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
      const projectRows = yield* sql`
        SELECT project_id AS "projectId", title, workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection", created_at AS "createdAt",
          updated_at AS "updatedAt",
          ${columns.some(({ name }) => name === "archived_at") ? sql`archived_at` : sql`NULL`} AS "archivedAt",
          ${columns.some(({ name }) => name === "pinned_at") ? sql`pinned_at` : sql`NULL`} AS "pinnedAt"
        FROM projection_projects WHERE deleted_at IS NULL`;
      const registered = yield* Effect.forEach(projectRows, (row) => decodeProject(row));
      const rows = yield* sql<{ readonly payload_json: string }>`
        SELECT thread.payload_json FROM orchestration_v2_projection_threads thread
        JOIN projection_projects project ON project.project_id = thread.project_id
        WHERE thread.deleted_at IS NULL AND project.deleted_at IS NULL
        ORDER BY thread.created_at, thread.thread_id`;
      const threads = yield* Effect.forEach(rows, ({ payload_json }) => decodeThread(payload_json));
      const transcripts = yield* Effect.forEach(threads, (thread) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly payload_json: string }>`
            SELECT payload_json FROM orchestration_v2_projection_messages
            WHERE thread_id = ${thread.id}
            ORDER BY created_at, message_id`;
          const messages = yield* Effect.forEach(rows, ({ payload_json }) =>
            decodeMessage(payload_json),
          );
          return { thread, messages };
        }),
      );
      return { projects: registered, transcripts };
    }),
  );
});

const copiedProjectId = (projectId: ProjectId) =>
  ProjectId.make(`${SETUP_COPY_PROJECT_PREFIX}${projectId}`);

const writeCopy = Effect.fn("SetupCopy.writeCopy")(function* (
  source: Effect.Success<ReturnType<typeof readSource>>,
) {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const application = yield* OrchestrationEventStore.OrchestrationEventStore;
  const sink = yield* EventSink.EventSinkV2;
  for (const project of source.projects) {
    const projectId = copiedProjectId(project.projectId);
    const base = {
      aggregateKind: "project" as const,
      aggregateId: projectId,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
    };
    yield* projects.apply(
      yield* application.appendProjectEvent({
        ...base,
        eventId: EventId.make(`setup-copy:project:${project.projectId}`),
        type: "project.created",
        occurredAt: project.createdAt,
        payload: {
          projectId,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
          defaultModelSelection: project.defaultModelSelection,
          defaultThreadEnvMode: "worktree",
          scripts: [],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      }),
    );
    if (project.archivedAt !== null || project.pinnedAt !== null) {
      yield* projects.apply(
        yield* application.appendProjectEvent({
          ...base,
          eventId: EventId.make(`setup-copy:project-metadata:${project.projectId}`),
          type: "project.meta-updated",
          occurredAt: project.updatedAt,
          payload: {
            projectId,
            archivedAt: project.archivedAt,
            pinnedAt: project.pinnedAt,
            updatedAt: project.updatedAt,
          },
        }),
      );
    }
  }

  for (const { thread, messages } of source.transcripts) {
    const id = ThreadId.make(`${SETUP_COPY_THREAD_PREFIX}${thread.id}`);
    const payload: OrchestrationV2AppThread = {
      createdBy: "system",
      creationSource: "server",
      id,
      projectId: copiedProjectId(thread.projectId),
      title: thread.title,
      providerInstanceId: thread.providerInstanceId,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      historyOrigin: "v1_import",
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
      forkedFrom: null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      settledOverride: thread.settledOverride,
      settledAt: thread.settledAt,
      lastVisitedAt: null,
      deletedAt: null,
    };
    yield* sink.write({
      events: [
        {
          id: EventId.make(`setup-copy:thread:${id}`),
          type: "thread.created",
          threadId: id,
          occurredAt: thread.createdAt,
          payload,
        },
        ...messages.flatMap((message, index) =>
          (message.role === "user" || message.role === "assistant") && message.text.trim() !== ""
            ? importedMessageEvents({
                eventPrefix: "setup-copy",
                threadId: id,
                index,
                message: {
                  role: message.role,
                  text: message.text,
                  createdAt: DateTime.formatIso(message.createdAt),
                },
              })
            : [],
        ),
      ],
    });
  }
});

const canonicalDirectory = Effect.fn("SetupCopy.canonicalDirectory")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const suffix: string[] = [];
  let ancestor = path.resolve(directory);
  while (!(yield* fs.exists(ancestor))) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(yield* fs.realPath(ancestor), ...suffix);
});

export const assertSeparateSetupHome = Effect.fn("SetupCopy.assertSeparateHome")(function* (
  sourceHome: string,
  targetHome: string,
) {
  const path = yield* Path.Path;
  const source = yield* canonicalDirectory(sourceHome);
  const state = yield* canonicalDirectory(path.join(source, "userdata"));
  const target = yield* canonicalDirectory(targetHome);
  const overlaps = [source, state].some((protectedDirectory) => {
    const relative = path.relative(protectedDirectory, target);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  });
  if (overlaps) {
    return yield* new SetupCopyError({
      message: "Choose a separate T3 home for the trial.",
    });
  }
});

export const copySetup = Effect.fn("SetupCopy.copy")(function* (input: {
  readonly sourceHome: string;
  readonly targetHome: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourceHome = yield* canonicalDirectory(input.sourceHome);
  const sourceState = yield* canonicalDirectory(path.join(sourceHome, "userdata"));
  const targetHome = yield* canonicalDirectory(input.targetHome);
  const state = path.join(targetHome, "userdata");
  const sourceDb = path.join(sourceState, "statev2.sqlite");
  yield* assertSeparateSetupHome(sourceHome, targetHome);
  if (yield* fs.exists(state)) {
    return yield* new SetupCopyError({
      message: "Copy into a fresh, separate T3 home before opening it.",
    });
  }
  if (!(yield* fs.exists(sourceDb))) {
    return yield* new SetupCopyError({ message: `No T3 V2 setup was found at ${sourceHome}.` });
  }

  const source = yield* readSource().pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: sourceDb, readonly: true })),
    Effect.mapError(
      (cause) =>
        new SetupCopyError({
          message:
            "This T3 setup could not be read. Choose Start fresh or try a compatible T3 V2 setup.",
          cause,
        }),
    ),
  );
  const settingsPath = path.join(sourceState, "settings.json");
  const preferences = (yield* fs.exists(settingsPath))
    ? yield* fs.readFileString(settingsPath).pipe(
        Effect.flatMap(decodePreferences),
        Effect.orElseSucceed(() => ({})),
      )
    : {};

  yield* fs.makeDirectory(targetHome, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({
    directory: targetHome,
    prefix: ".setup-copy-",
  });
  const dbPath = path.join(staging, "statev2.sqlite");
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer);
  yield* writeCopy(source).pipe(
    Effect.provide(
      Layer.mergeAll(
        ProjectStore.layer,
        OrchestrationEventStore.layer,
        EventSink.layer.pipe(Layer.provide(stores)),
      ).pipe(Layer.provide(SqlitePersistence.layerFromPath(dbPath))),
    ),
  );
  yield* fs.chmod(dbPath, 0o600);
  yield* fs.writeFileString(
    path.join(staging, "settings.json"),
    yield* encodeSettings({
      ...preferences,
      ...trialDefaults,
      projectSettingsOverrides: Object.fromEntries(
        source.projects.map((project) => [
          copiedProjectId(project.projectId),
          { defaultThreadEnvMode: "worktree" },
        ]),
      ),
    }),
    { mode: 0o600 },
  );
  yield* fs.rename(staging, state);

  return { projects: source.projects.length, threads: source.transcripts.length };
}, Effect.scoped);

export const initializeFreshTrial = Effect.fn("SetupCopy.initializeFreshTrial")(function* (
  home: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = path.join(home, "userdata");
  if (yield* fs.exists(state)) return;
  yield* fs.makeDirectory(home, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: home, prefix: ".trial-" });
  yield* fs.writeFileString(
    path.join(staging, "settings.json"),
    yield* encodeSettings(trialDefaults),
    {
      mode: 0o600,
    },
  );
  yield* fs
    .rename(staging, state)
    .pipe(
      Effect.catch((cause) =>
        Effect.flatMap(fs.exists(state), (exists) => (exists ? Effect.void : Effect.fail(cause))),
      ),
    );
}, Effect.scoped);
