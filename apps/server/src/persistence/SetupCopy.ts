import {
  EventId,
  ModelSelection,
  ProjectId,
  OrchestrationV2AppThreadJson,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
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
import {
  resolveSetupCopyProviders,
  SetupCopyProviderError,
  type SetupCopyProviderMappings,
} from "./SetupCopyProviders.ts";

export class SetupCopyError extends Schema.TaggedError<SetupCopyError>()("SetupCopyError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class SetupCopyPendingLegacyError extends Schema.TaggedError<SetupCopyPendingLegacyError>()(
  "SetupCopyPendingLegacyError",
  { pendingThreads: Schema.Number },
) {
  override get message(): string {
    return `This T3 setup has ${this.pendingThreads} legacy conversations awaiting import. Open the original setup with a compatible T3 Code version, let its conversation import finish, then retry the trial copy. The original setup and trial were not changed.`;
  }
}

const decodeThread = Schema.decodeEffect(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const trialDefaults = {
  defaultThreadEnvMode: "worktree",
  newWorktreesStartFromOrigin: false,
} as const;
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

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
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const [pending] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM (
          SELECT thread.thread_id FROM projection_threads thread
          WHERE NOT EXISTS (
            SELECT 1 FROM orchestration_events event INDEXED BY orchestration_events_v2_created_threads_idx
            WHERE event.application_event_version = 2 AND event.aggregate_kind = 'thread'
              AND event.stream_id = thread.thread_id AND event.event_type = 'thread.created'
          )
          UNION
          SELECT thread_id FROM orchestration_v2_legacy_imports
          WHERE transcript_imported_at IS NULL
        )`;
      if (pending !== undefined && pending.count > 0) {
        return yield* new SetupCopyPendingLegacyError({ pendingThreads: pending.count });
      }
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
          const messages: Array<{
            role: "user" | "assistant";
            text: string;
            createdAt: DateTime.Utc;
          }> = [];
          let afterPosition = -1;
          while (true) {
            const page = yield* projection.getTimelinePage(thread.id, {
              view: "messages",
              afterPosition,
              limit: 500,
            });
            for (const { item } of page.items) {
              if (item.type !== "user_message" && item.type !== "assistant_message") continue;
              messages.push({
                role: item.type === "user_message" ? "user" : "assistant",
                text: item.text,
                createdAt: item.startedAt ?? item.completedAt ?? item.updatedAt,
              });
            }
            const last = page.items.at(-1);
            if (!page.hasMore || last === undefined) break;
            afterPosition = last.position;
          }
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
  readonly providerMappings?: SetupCopyProviderMappings;
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
    Effect.provide(
      ProjectionStore.layer.pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: sourceDb, readonly: true })),
      ),
    ),
    Effect.mapError((cause) =>
      cause._tag === "SetupCopyPendingLegacyError"
        ? cause
        : new SetupCopyError({
            message:
              "This T3 setup could not be read. Choose Start fresh or try a compatible T3 V2 setup.",
            cause,
          }),
    ),
  );
  const settingsPath = path.join(sourceState, "settings.json");
  const settingsJson = (yield* fs.exists(settingsPath))
    ? yield* fs
        .readFileString(settingsPath)
        .pipe(
          Effect.mapError(
            (cause) =>
              new SetupCopyProviderError({ reason: "settings-unreadable", instanceIds: [], cause }),
          ),
        )
    : undefined;
  const providers = yield* resolveSetupCopyProviders({
    ...(settingsJson === undefined ? {} : { settingsJson }),
    modelSelections: [
      ...source.projects.flatMap((project) =>
        project.defaultModelSelection === null ? [] : [project.defaultModelSelection],
      ),
      ...source.transcripts.map(({ thread }) => thread.modelSelection),
    ],
    instanceIds: source.transcripts.map(({ thread }) => thread.providerInstanceId),
    ...(input.providerMappings === undefined ? {} : { mappings: input.providerMappings }),
  });
  const resolvedSource = {
    projects: source.projects.map((project) => ({
      ...project,
      defaultModelSelection:
        project.defaultModelSelection === null
          ? null
          : providers.modelSelection(project.defaultModelSelection),
    })),
    transcripts: source.transcripts.map(({ thread, messages }) => ({
      messages,
      thread: {
        ...thread,
        providerInstanceId: providers.instanceId(thread.providerInstanceId),
        modelSelection: providers.modelSelection(thread.modelSelection),
      },
    })),
  };

  yield* fs.makeDirectory(targetHome, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({
    directory: targetHome,
    prefix: ".setup-copy-",
  });
  const dbPath = path.join(staging, "statev2.sqlite");
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer);
  yield* writeCopy(resolvedSource).pipe(
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
      ...providers.preferences,
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
