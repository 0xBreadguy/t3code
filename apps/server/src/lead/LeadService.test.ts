import {
  CommandId,
  type ComposerContextRecord,
  ComposerContextId,
  EnvironmentId,
  leadStateRevisionProblem,
  MessageId,
  type OrchestrationMessageContext,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ServerSettingsError,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as LeadService from "./LeadService.ts";

const projectId = ProjectId.make("project-lead-service");
const otherProjectId = ProjectId.make("project-lead-service-other");
const leadThreadId = ThreadId.make(`lead:${projectId}`);
const otherLeadThreadId = ThreadId.make(`lead:${otherProjectId}`);
const workerThreadId = ThreadId.make("thread-lead-worker");
const otherWorkerThreadId = ThreadId.make("thread-lead-worker-other");
const instanceId = ProviderInstanceId.make("codex");
const environmentId = EnvironmentId.make("environment-lead-service");
const modelSelection = { instanceId, model: "gpt-6-sol" };
const otherModelSelection = { instanceId, model: "gpt-6-sol-review" };
const now = DateTime.makeUnsafe("2026-11-08T00:00:00.000Z");
const gitHead = "0123456789abcdef0123456789abcdef01234567";

const provider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-08T00:00:00.000Z",
  models: [
    { slug: modelSelection.model, name: "Sol", isCustom: false },
    { slug: otherModelSelection.model, name: "Review", isCustom: false },
  ],
} as unknown as ServerProvider;

const run = (id: string, ordinal: number, status: "completed" | "running" = "completed") =>
  ({
    id,
    threadId: workerThreadId,
    ordinal,
    status,
    providerInstanceId: instanceId,
    modelSelection,
  }) as unknown as OrchestrationV2ThreadProjection["runs"][number];

const makeProjection = (input: {
  readonly id: ThreadId;
  readonly projectId?: ProjectId | undefined;
  readonly title?: string | undefined;
  readonly leadState?: OrchestrationV2ThreadProjection["thread"]["leadState"];
  readonly archivedAt?: OrchestrationV2ThreadProjection["thread"]["archivedAt"];
  readonly deletedAt?: OrchestrationV2ThreadProjection["thread"]["deletedAt"];
  readonly runs?: ReadonlyArray<OrchestrationV2ThreadProjection["runs"][number]> | undefined;
}): OrchestrationV2ThreadProjection =>
  ({
    thread: {
      id: input.id,
      projectId: input.projectId ?? projectId,
      title: input.title ?? "Thread",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.id },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: input.archivedAt ?? null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: input.deletedAt ?? null,
      ...(input.leadState === undefined ? {} : { leadState: input.leadState }),
    },
    runs: input.runs ?? [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  }) as unknown as OrchestrationV2ThreadProjection;

const contextThread = (
  threadId: ThreadId,
  environment: EnvironmentId,
  title: string,
): ComposerContextRecord => ({
  version: 1,
  contextId: ComposerContextId.make(`ctx-${threadId}`),
  label: title,
  kind: "thread",
  environmentId: environment,
  threadId,
  title,
});

interface HarnessInput {
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly threads?: ReadonlyArray<OrchestrationV2ThreadProjection> | undefined;
  /** Number of settings writes to reject before accepting one. */
  readonly settingsWriteFailures?: number | undefined;
  /** Handoff reads wait until this many lead reads are pending, then all continue. */
  readonly leadReadBarrier?: boolean | undefined;
}

const makeHarness = Effect.fn("LeadServiceTest.makeHarness")(function* (input: HarnessInput) {
  const threads = yield* Ref.make(
    new Map<ThreadId, OrchestrationV2ThreadProjection>(
      (input.threads ?? []).map((projection) => [projection.thread.id, projection]),
    ),
  );
  const sends = yield* Ref.make<ReadonlyArray<ThreadManagementService.ThreadManagementSendInput>>(
    [],
  );
  const sendResults = yield* Ref.make(new Map<string, unknown>());
  const failuresLeft = yield* Ref.make(input.settingsWriteFailures ?? 0);
  const readBarrier = yield* Deferred.make<void>();
  const readGate = yield* Ref.make({ enabled: input.leadReadBarrier === true, count: 0 });

  const settingsLayer = Layer.effect(
    ServerSettings.ServerSettingsService,
    Effect.gen(function* () {
      const inner = yield* ServerSettings.ServerSettingsService;
      return {
        ...inner,
        updateSettings: (patch) =>
          Effect.gen(function* () {
            const remaining = yield* Ref.get(failuresLeft);
            if (remaining > 0) {
              yield* Ref.set(failuresLeft, remaining - 1);
              return yield* new ServerSettingsError({
                settingsPath: "/test/settings.json",
                operation: "write-file",
                cause: new Error("simulated settings write failure"),
              });
            }
            return yield* inner.updateSettings(patch);
          }),
      } satisfies ServerSettings.ServerSettingsService["Service"];
    }),
  ).pipe(Layer.provide(ServerSettings.layerTest(input.settings)));

  const threadManagementLayer = Layer.mock(ThreadManagementService.ThreadManagementService)({
    hasReceipt: (commandId) =>
      Ref.get(sendResults).pipe(Effect.map((results) => results.has(commandId))),
    getThreadProjection: (threadId) =>
      Effect.gen(function* () {
        if (threadId === leadThreadId) {
          const gate = yield* Ref.get(readGate);
          if (gate.enabled) {
            const next = yield* Ref.updateAndGet(readGate, (current) => ({
              ...current,
              count: current.count + 1,
            }));
            if (next.count >= 2) {
              yield* Ref.set(readGate, { enabled: false, count: 0 });
              yield* Deferred.succeed(readBarrier, undefined);
            }
            yield* Deferred.await(readBarrier);
          }
        }
        const current = yield* Ref.get(threads);
        const projection = current.get(threadId);
        if (projection === undefined) {
          return yield* new Orchestrator.OrchestratorProjectionError({
            threadId,
            cause: new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }),
          });
        }
        return projection;
      }),
    sendToThread: (sendInput) =>
      Effect.gen(function* () {
        const results = yield* Ref.get(sendResults);
        const existing = results.get(sendInput.commandId);
        if (existing !== undefined) return existing as never;
        yield* Ref.update(sends, (current) => [...current, sendInput]);
        const result = {
          dispatch: { sequence: 7 },
          projection: {
            thread: makeProjection({ id: sendInput.threadId, title: "Project lead" }).thread,
            runs: [],
            messages: [],
            turnItems: [],
          },
          message: {},
          run: { id: `run:send:${sendInput.commandId}` },
          turnItem: null,
          delivery: "started",
        } as never;
        yield* Ref.update(sendResults, (current) =>
          new Map(current).set(sendInput.commandId, result),
        );
        return result;
      }),
    dispatch: (command) =>
      Effect.gen(function* () {
        if (command.type !== "thread.metadata.update") {
          return yield* Effect.die(`unexpected command ${command.type}`);
        }
        const outcome = yield* Ref.modify(
          threads,
          (
            current,
          ): [
            { readonly ok: boolean; readonly missing: boolean },
            Map<ThreadId, OrchestrationV2ThreadProjection>,
          ] => {
            const projection = current.get(command.threadId);
            if (projection === undefined) return [{ ok: false, missing: true }, current];
            const leadState = projection.thread.leadState ?? null;
            const problem = leadStateRevisionProblem({
              currentRevision: leadState?.revision,
              expectedRevision: command.expectedLeadRevision,
              nextRevision: command.leadState?.revision,
            });
            if (problem !== null) return [{ ok: false, missing: false }, current];
            const next = new Map(current);
            next.set(command.threadId, {
              ...projection,
              thread: {
                ...projection.thread,
                ...(command.leadState === undefined ? {} : { leadState: command.leadState }),
              },
            });
            return [{ ok: true, missing: false }, next];
          },
        );
        if (!outcome.ok) {
          return yield* new Orchestrator.OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
            cause: new Error(outcome.missing ? "thread missing" : "stale lead revision"),
          });
        }
        return { sequence: 1, storedEvents: [] } as never;
      }),
  });

  const threadLaunchLayer = Layer.mock(ThreadLaunchService.ThreadLaunchService)({
    launch: (launchInput) =>
      Effect.gen(function* () {
        const id = launchInput.threadId!;
        const projection = makeProjection({
          id,
          projectId: launchInput.projectId,
          title: launchInput.title,
        });
        yield* Ref.update(threads, (current) => new Map(current).set(id, projection));
        return {
          threadId: id,
          projection,
          resumed: false,
        } as never;
      }),
  });

  const layer = LeadService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        settingsLayer,
        threadManagementLayer,
        threadLaunchLayer,
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (requestedProjectId) =>
            requestedProjectId === projectId || requestedProjectId === otherProjectId
              ? Effect.succeedSome({
                  projectId: requestedProjectId,
                  title: requestedProjectId === projectId ? "Lead project" : "Other lead project",
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
                } as never)
              : Effect.succeedNone,
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([provider]),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolveCommit: () => Effect.succeed({ commitSha: gitHead } as never),
        }),
        Layer.succeed(
          ServerEnvironment.ServerEnvironmentIdentity,
          ServerEnvironment.ServerEnvironmentIdentity.of({
            getEnvironmentId: Effect.succeed(environmentId),
          }),
        ),
      ),
    ),
  );

  return {
    layer,
    sends: () => Ref.get(sends),
    threads: () => Ref.get(threads),
    deleteThread: (threadId: ThreadId) =>
      Ref.update(threads, (current) => {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      }),
  };
});

const leadBinding = {
  threadId: leadThreadId,
  workerDefault: "handoff" as const,
  workerFinishOverrides: {},
};

it.effect("ensures one stable lead thread, then sends through the ordinary pipeline", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: {
        agentRoleModels: { lead: modelSelection },
        providerInstances: {
          [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
        },
      },
    });
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
      assert.equal(sent.runId, "run:send:lead-send-1");
      assert.equal(sent.delivery, "started");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("recovers after a settings write fails behind a committed lead thread", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { agentRoleModels: { lead: modelSelection } },
      settingsWriteFailures: 2,
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const failed = yield* lead
        .ensure({ projectId, requestId: "ensure-recover" })
        .pipe(Effect.flip);
      assert.equal(failed.reason, "orchestration_error");

      const recovered = yield* lead.ensure({ projectId, requestId: "ensure-recover-again" });
      assert.equal(recovered.threadId, leadThreadId);
      assert.isFalse(recovered.created);
      assert.equal(recovered.binding.threadId, leadThreadId);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("keeps unrelated roles while configuring and rejects conflicting appointments", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: {
        agentRoleModels: { lead: modelSelection, review: modelSelection },
        projectSettingsOverrides: {
          [projectId]: { agentRoleModels: { design: modelSelection } },
        },
        projectLeadConfigs: { [projectId]: leadBinding },
      },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({ id: workerThreadId, title: "Worker" }),
        makeProjection({
          id: otherWorkerThreadId,
          projectId: otherProjectId,
          title: "Other worker",
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const configured = yield* lead.configure({
        projectId,
        workerDefault: "independent",
        roleModels: { review: otherModelSelection },
        projectRoleModels: { design: otherModelSelection },
      });
      assert.equal(configured.roleModels.lead?.model, modelSelection.model);
      assert.equal(configured.roleModels.review?.model, otherModelSelection.model);
      assert.equal(configured.roleModels.design?.model, otherModelSelection.model);
      assert.equal(configured.roleModels.implementation, undefined);
      assert.equal(configured.binding?.workerDefault, "independent");

      const conflict = yield* lead
        .ensure({
          projectId,
          requestId: "conflicting-appointment",
          existingThreadId: workerThreadId,
        })
        .pipe(Effect.flip);
      assert.equal(conflict.reason, "invalid_request");

      const wrongProject = yield* lead
        .configure({ projectId, existingThreadId: otherWorkerThreadId })
        .pipe(Effect.flip);
      assert.equal(wrongProject.reason, "wrong_project");

      const binding = yield* lead.read({ projectId });
      assert.equal(binding.binding?.threadId, leadThreadId);
      assert.equal(binding.roleModels.lead?.model, modelSelection.model);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("validates captured context threads and forwards only the records that remain", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { projectLeadConfigs: { [projectId]: leadBinding } },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({ id: workerThreadId, title: "Captured worker" }),
        makeProjection({
          id: otherWorkerThreadId,
          projectId: otherProjectId,
          title: "Foreign worker",
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const context: OrchestrationMessageContext = {
        version: 1,
        records: [
          contextThread(workerThreadId, environmentId, "stale title"),
          {
            version: 1,
            contextId: ComposerContextId.make("ctx-diff"),
            label: "Parser diff",
            kind: "review-comment",
            sectionId: "diff",
            sectionTitle: "Parser diff",
            filePath: "src/parser.ts",
            startIndex: 0,
            endIndex: 1,
            rangeLabel: "1",
            text: "const parse",
            diff: "+const parse",
          },
        ],
      };
      yield* lead.send({
        projectId,
        commandId: CommandId.make("lead-send-context"),
        messageId: MessageId.make("lead-message-context"),
        text: "Review this worker change.",
        context,
      });
      const sent = (yield* harness.sends())[0]!;
      assert.equal(sent.context?.records.length, 2);
      const captured = sent.context?.records[0];
      assert.equal(captured?.kind, "thread");
      if (captured?.kind === "thread" && "threadId" in captured && "environmentId" in captured) {
        assert.equal(captured.environmentId, environmentId);
        assert.equal(captured.threadId, workerThreadId);
        assert.equal(captured.title, "Captured worker");
      }

      const foreignEnvironment = yield* lead
        .send({
          projectId,
          commandId: CommandId.make("lead-send-foreign-environment"),
          messageId: MessageId.make("lead-message-foreign-environment"),
          text: "Review.",
          context: {
            version: 1,
            records: [contextThread(workerThreadId, EnvironmentId.make("elsewhere"), "Worker")],
          },
        })
        .pipe(Effect.flip);
      assert.equal(foreignEnvironment.reason, "wrong_project");

      const foreignProject = yield* lead
        .send({
          projectId,
          commandId: CommandId.make("lead-send-foreign-project"),
          messageId: MessageId.make("lead-message-foreign-project"),
          text: "Review.",
          context: {
            version: 1,
            records: [contextThread(otherWorkerThreadId, environmentId, "Foreign worker")],
          },
        })
        .pipe(Effect.flip);
      assert.equal(foreignProject.reason, "wrong_project");

      const removedChip = yield* lead.send({
        projectId,
        commandId: CommandId.make("lead-send-removed-chip"),
        messageId: MessageId.make("lead-message-removed-chip"),
        text: "Review without the worker chip.",
        context: {
          version: 1,
          records: [
            {
              version: 1,
              contextId: ComposerContextId.make("ctx-file-only"),
              label: "parser.ts",
              kind: "file",
              attachmentId: "attachment-1",
              name: "parser.ts",
              mimeType: "text/plain",
              sizeBytes: 12,
            },
          ],
        },
      });
      assert.equal(removedChip.threadId, leadThreadId);
      const sentCount = (yield* harness.sends()).length;
      const sentRemoved = (yield* harness.sends())[sentCount - 1]!;
      assert.deepEqual(
        sentRemoved.context?.records.map((record) => record.contextId),
        ["ctx-file-only"],
      );

      const oldCaller = yield* lead.send({
        projectId,
        commandId: CommandId.make("lead-send-old-caller"),
        messageId: MessageId.make("lead-message-old-caller"),
        text: "No context.",
      });
      assert.equal(oldCaller.threadId, leadThreadId);
      const sentOld = (yield* harness.sends()).at(-1)!;
      assert.equal(sentOld.context, undefined);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("keeps send identity on retry and never records a second turn", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { projectLeadConfigs: { [projectId]: leadBinding } },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({ id: workerThreadId, title: "Worker" }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const commandId = CommandId.make("lead-send-retry");
      const messageId = MessageId.make("lead-message-retry");
      const context: OrchestrationMessageContext = {
        version: 1,
        records: [contextThread(workerThreadId, environmentId, "Worker")],
      };
      const first = yield* lead.send({
        projectId,
        commandId,
        messageId,
        text: "Review pending work.",
        context,
      });
      // A committed retry must not fail because a captured source disappeared later.
      yield* harness.deleteThread(workerThreadId);
      const second = yield* lead.send({
        projectId,
        commandId,
        messageId,
        text: "Review pending work.",
        context,
      });
      assert.equal(second.runId, first.runId);
      assert.equal(second.sequence, first.sequence);
      assert.equal((yield* harness.sends()).length, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("dedupes a retried handoff by source run and head", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { projectLeadConfigs: { [projectId]: leadBinding } },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({
          id: workerThreadId,
          title: "Worker",
          runs: [run("run-worker-1", 1)],
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const first = yield* lead.handoff({
        callerThreadId: workerThreadId,
        input: {
          summary: "Parser fix is ready for review.",
          checks: [{ name: "vp test run", outcome: "passed" }],
        },
      });
      assert.isTrue(first.created);
      assert.equal(first.handoff.reviewStatus, "review_required");
      assert.equal(first.handoff.head, gitHead);
      assert.equal(first.pendingHandoffCount, 1);

      const retried = yield* lead.handoff({
        callerThreadId: workerThreadId,
        input: {
          summary: "Parser fix is ready for review.",
          checks: [{ name: "vp test run", outcome: "passed" }],
        },
      });
      assert.isFalse(retried.created);
      assert.equal(retried.pendingHandoffCount, 1);
      assert.equal(retried.revision, first.revision);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("applies a grant after handoffs, then revokes it and rejects stale mutations", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { projectLeadConfigs: { [projectId]: leadBinding } },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({
          id: workerThreadId,
          title: "Worker",
          runs: [run("run-worker-1", 1)],
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const handoff = yield* lead.handoff({
        callerThreadId: workerThreadId,
        input: { summary: "Ready for review.", checks: [] },
      });
      assert.equal(handoff.revision, 1);

      const granted = yield* lead.grant({
        projectId,
        expectedRevision: handoff.revision,
        scope: { type: "project" },
        actions: ["reconcile"],
      });
      assert.equal(granted.ownership?.id, `grant:${projectId}:2`);
      assert.equal(granted.ownership?.revokedAt, null);
      assert.equal(granted.revision, 2);

      const revoked = yield* lead.revoke({
        projectId,
        expectedRevision: granted.revision,
        grantId: granted.ownership!.id,
      });
      assert.notEqual(revoked.ownership?.revokedAt, null);
      assert.equal(revoked.revision, 3);

      const stale = yield* lead
        .grant({
          projectId,
          expectedRevision: handoff.revision,
          scope: { type: "project" },
          actions: ["merge"],
        })
        .pipe(Effect.flip);
      assert.equal(stale.reason, "stale_revision");

      const alreadyRevoked = yield* lead
        .revoke({
          projectId,
          expectedRevision: revoked.revision,
          grantId: revoked.ownership!.id,
        })
        .pipe(Effect.flip);
      assert.equal(alreadyRevoked.reason, "ownership_missing");

      const status = yield* lead.status({ callerThreadId: leadThreadId, projectId });
      assert.equal(status.pendingHandoffs.length, 1);
      assert.equal(status.ownership?.id, granted.ownership?.id);
      assert.notEqual(status.ownership?.revokedAt, null);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not lose a handoff or a grant when both commit concurrently", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: { projectLeadConfigs: { [projectId]: leadBinding } },
      leadReadBarrier: true,
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({
          id: workerThreadId,
          title: "Worker",
          runs: [run("run-worker-1", 1)],
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const grantFiber = yield* lead
        .grant({
          projectId,
          expectedRevision: 0,
          scope: { type: "project" },
          actions: ["reconcile"],
        })
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      const handoffFiber = yield* lead
        .handoff({
          callerThreadId: workerThreadId,
          input: { summary: "Race with a grant.", checks: [] },
        })
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      const [grantResult, handoffResult] = yield* Effect.all([
        Fiber.join(grantFiber),
        Fiber.join(handoffFiber),
      ]);

      assert.equal(handoffResult._tag, "Success");
      const status = yield* lead.status({ callerThreadId: leadThreadId, projectId });
      assert.equal(status.pendingHandoffs.length, 1);
      if (grantResult._tag === "Success") {
        assert.equal(grantResult.success.ownership?.id, `grant:${projectId}:1`);
        assert.equal(status.ownership?.id, grantResult.success.ownership?.id);
        assert.equal(status.revision, 2);
      } else {
        assert.equal(grantResult.failure.reason, "stale_revision");
        assert.equal(status.ownership, null);
        assert.equal(status.revision, 1);
      }
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("rejects foreign handoff sources and grant targets without touching lead state", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      settings: {
        projectLeadConfigs: {
          [projectId]: leadBinding,
          [otherProjectId]: {
            threadId: otherLeadThreadId,
            workerDefault: "handoff",
            workerFinishOverrides: {},
          },
        },
      },
      threads: [
        makeProjection({ id: leadThreadId, title: "Project lead" }),
        makeProjection({
          id: otherLeadThreadId,
          projectId: otherProjectId,
          title: "Other lead",
        }),
        makeProjection({
          id: workerThreadId,
          title: "Worker",
          runs: [run("run-worker-1", 1)],
        }),
        makeProjection({
          id: otherWorkerThreadId,
          projectId: otherProjectId,
          title: "Other worker",
          runs: [run("run-other-worker-1", 1)],
        }),
      ],
    });
    yield* Effect.gen(function* () {
      const lead = yield* LeadService.LeadService;
      const foreignSource = yield* lead
        .handoff({
          callerThreadId: workerThreadId,
          input: {
            sourceThreadId: otherWorkerThreadId,
            summary: "Wrong source.",
            checks: [],
          },
        })
        .pipe(Effect.flip);
      assert.equal(foreignSource.reason, "invalid_request");

      const foreignGrant = yield* lead
        .grant({
          projectId,
          expectedRevision: 0,
          scope: { type: "threads", threadIds: [otherWorkerThreadId] },
          actions: ["open_pr"],
        })
        .pipe(Effect.flip);
      assert.equal(foreignGrant.reason, "wrong_project");

      const read = yield* lead.read({ projectId });
      assert.equal(read.state, null);
      assert.equal(read.pendingHandoffCount, 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);
