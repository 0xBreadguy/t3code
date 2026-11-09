import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as LeadService from "./LeadService.ts";

const projectId = ProjectId.make("project-lead-service");
const leadThreadId = ThreadId.make("lead:project-lead-service");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-6-sol" };
const now = DateTime.makeUnsafe("2026-11-08T00:00:00.000Z");

const thread = (id: ThreadId, title: string) =>
  ({
    id,
    projectId,
    title,
    providerInstanceId: instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  }) as OrchestrationV2ThreadProjection["thread"];

const projection = (id: ThreadId, title: string) =>
  ({ thread: thread(id, title), runs: [] }) as unknown as OrchestrationV2ThreadProjection;

const provider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-08T00:00:00.000Z",
  models: [{ slug: modelSelection.model, name: "Sol", isCustom: false }],
} as unknown as ServerProvider;

const layerTest = Layer.mergeAll(
  ServerSettings.layerTest({
    agentRoleModels: { lead: modelSelection },
    providerInstances: {
      [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
    },
  }),
  Layer.mock(ProjectStore.ProjectStoreV2)({
    get: () =>
      Effect.succeedSome({
        projectId,
        title: "Lead project",
        workspaceRoot: "/repo",
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        autoPull: false,
        faviconPath: null,
        projectIcon: null,
        scripts: [],
        createdAt: "2026-11-08T00:00:00.000Z",
        updatedAt: "2026-11-08T00:00:00.000Z",
        deletedAt: null,
      }),
  }),
  Layer.mock(ProviderRegistry.ProviderRegistry)({
    getProviders: Effect.succeed([provider]),
  }),
  Layer.mock(GitVcsDriver.GitVcsDriver)({}),
);

const layerWithThread = (launched: Ref.Ref<boolean>) =>
  Layer.mergeAll(
    layerTest,
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadProjection: (threadId: ThreadId) =>
        threadId === leadThreadId
          ? Ref.get(launched).pipe(
              Effect.flatMap((exists) =>
                exists
                  ? Effect.succeed(projection(leadThreadId, "Project lead"))
                  : Effect.fail(new Error("thread not created yet") as never),
              ),
            )
          : Effect.succeed(projection(threadId, "Worker")),
      sendToThread: (input) =>
        Effect.succeed({
          dispatch: { sequence: 7 },
          projection: {
            thread: thread(input.threadId, "Project lead"),
            runs: [],
            messages: [],
            turnItems: [],
          },
          message: {},
          run: { id: "run:lead:1" },
          turnItem: null,
          delivery: "started",
        } as never),
    }),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        Ref.set(launched, true).pipe(
          Effect.as({
            threadId: input.threadId!,
            projection: projection(input.threadId!, input.title),
            resumed: false,
          }),
        ),
    }),
  );

it.effect("ensures one stable lead thread, then sends through the ordinary pipeline", () =>
  Effect.gen(function* () {
    const launched = yield* Ref.make(false);
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const first = yield* lead.ensure({ projectId, requestId: "ensure-1" });
      assert.equal(first.threadId, leadThreadId);
      assert.isTrue(first.created);
      assert.equal(first.binding.threadId, leadThreadId);
      assert.equal(first.modelSelection.model, modelSelection.model);
      assert.equal(first.policySource, "environment_role");

      const second = yield* lead.ensure({ projectId, requestId: "ensure-2" });
      assert.isFalse(second.created);
      assert.equal(second.threadId, leadThreadId);

      const sent = yield* lead.send({
        projectId,
        commandId: CommandId.make("lead-send-1"),
        messageId: MessageId.make("lead-message-1"),
        text: "Review pending work.",
      });
      assert.equal(sent.threadId, leadThreadId);
      assert.equal(sent.runId, "run:lead:1");
      assert.equal(sent.delivery, "started");
    }).pipe(Effect.provide(LeadService.layer.pipe(Layer.provide(layerWithThread(launched)))));
  }),
);
