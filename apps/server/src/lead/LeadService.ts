import {
  CommandId,
  LeadRpcError,
  type LeadAuthorityResult,
  type LeadConfigureInput,
  type LeadConfigureResult,
  type LeadEnsureInput,
  type LeadEnsureResult,
  type LeadGrantInput,
  type LeadHandoff,
  type LeadHandoffInput,
  type LeadHandoffResult,
  type LeadOwnershipGrant,
  type LeadReadInput,
  type LeadReadResult,
  type LeadRevokeInput,
  type LeadSendInput,
  type LeadSendResult,
  type LeadState,
  type LeadStatusResult,
  type LeadThreadSummary,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  type ProjectLeadWorkerFinish,
  resolveProjectProviderInstanceEnabled,
  type ServerProvider,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { effectiveAgentRoleModels, resolveAgentRoleModel } from "@t3tools/shared/agentRolePolicy";
import { appendLeadHandoff, leadThreadIdForProject } from "@t3tools/shared/leadPolicy";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

const LEAD_TITLE = "Project lead";
const MAX_CAS_ATTEMPTS = 5;

interface LeadServiceErrorInput {
  readonly operation: string;
  readonly reason: LeadRpcError["reason"];
  readonly message: string;
  readonly projectId?: ProjectId | undefined;
}

const fail = (input: LeadServiceErrorInput) => new LeadRpcError(input);

const isThreadMissingCause = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  (cause as { readonly _tag?: unknown })._tag === "ProjectionStoreThreadNotFoundError";

const isStaleDispatchError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  ((cause as { readonly _tag?: unknown })._tag === "OrchestratorDispatchError" ||
    (cause as { readonly _tag?: unknown })._tag === "OrchestratorThreadNotFoundError");

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const summaryOf = (thread: OrchestrationV2AppThread, active: boolean): LeadThreadSummary => ({
  threadId: thread.id,
  projectId: thread.projectId,
  title: thread.title,
  providerInstanceId: thread.providerInstanceId,
  model: thread.modelSelection.model,
  archived: thread.archivedAt !== null,
  active,
  updatedAt: DateTime.formatIso(thread.updatedAt),
});

const validateRoleSelection = Effect.fn("LeadService.validateRoleSelection")(function* (input: {
  readonly settings: ServerSettings;
  readonly projectId: ProjectId;
  readonly selection: ModelSelection;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  if (
    !resolveProjectProviderInstanceEnabled(
      input.settings,
      input.projectId,
      input.selection.instanceId,
    )
  ) {
    return yield* fail({
      operation: "role-model",
      reason: "provider_disabled",
      message: `Provider ${input.selection.instanceId} is disabled for project ${input.projectId}.`,
      projectId: input.projectId,
    });
  }
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.selection.instanceId,
  );
  if (provider === undefined || !provider.enabled) {
    return yield* fail({
      operation: "role-model",
      reason: "provider_disabled",
      message: `Provider ${input.selection.instanceId} is not enabled.`,
      projectId: input.projectId,
    });
  }
  // An empty catalog means this build cannot verify slugs yet; do not invent an unavailable result.
  if (
    provider.models.length > 0 &&
    !provider.models.some((candidate) => candidate.slug === input.selection.model)
  ) {
    return yield* fail({
      operation: "role-model",
      reason: "model_unavailable",
      message: `Model ${input.selection.model} is not offered by provider ${input.selection.instanceId}.`,
      projectId: input.projectId,
    });
  }
});

export class LeadService extends Context.Service<
  LeadService,
  {
    readonly ensure: (input: LeadEnsureInput) => Effect.Effect<LeadEnsureResult, LeadRpcError>;
    readonly read: (input: LeadReadInput) => Effect.Effect<LeadReadResult, LeadRpcError>;
    readonly send: (input: LeadSendInput) => Effect.Effect<LeadSendResult, LeadRpcError>;
    readonly configure: (
      input: LeadConfigureInput,
    ) => Effect.Effect<LeadConfigureResult, LeadRpcError>;
    readonly handoff: (input: {
      readonly callerThreadId: ThreadId;
      readonly input: LeadHandoffInput;
    }) => Effect.Effect<LeadHandoffResult, LeadRpcError>;
    readonly status: (input: {
      readonly callerThreadId: ThreadId | null;
      readonly projectId?: ProjectId | undefined;
    }) => Effect.Effect<LeadStatusResult, LeadRpcError>;
    readonly grant: (input: LeadGrantInput) => Effect.Effect<LeadAuthorityResult, LeadRpcError>;
    readonly revoke: (input: LeadRevokeInput) => Effect.Effect<LeadAuthorityResult, LeadRpcError>;
  }
>()("t3/lead/LeadService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settingsService = yield* ServerSettingsModule.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const requireProject = Effect.fn("LeadService.requireProject")(function* (projectId: ProjectId) {
    const project = yield* projects.get(projectId).pipe(
      Effect.mapError(
        (cause) =>
          new LeadRpcError({
            operation: "project-read",
            reason: "orchestration_error",
            message: `Project ${projectId} could not be read.`,
            projectId,
            cause,
          }),
      ),
    );
    if (Option.isNone(project)) {
      return yield* fail({
        operation: "project-read",
        reason: "project_not_found",
        message: `Project ${projectId} was not found.`,
        projectId,
      });
    }
    return project.value;
  });

  /** Reads a thread without a destination project; validation happens after. */
  const readThreadProjection = (threadId: ThreadId) =>
    threads.getThreadProjection(threadId).pipe(
      Effect.mapError((cause) =>
        isThreadMissingCause(cause.cause)
          ? fail({
              operation: "thread-read",
              reason: "thread_not_found",
              message: `Thread ${threadId} was not found.`,
            })
          : new LeadRpcError({
              operation: "thread-read",
              reason: "orchestration_error",
              message: `Thread ${threadId} could not be read.`,
              cause,
            }),
      ),
    );

  const readProjection = (threadId: ThreadId, projectId: ProjectId) =>
    readThreadProjection(threadId).pipe(
      Effect.mapError((error) =>
        error.projectId === undefined
          ? new LeadRpcError({
              operation: error.operation,
              reason: error.reason,
              message: error.message,
              projectId,
              cause: error.cause,
            })
          : error,
      ),
    );

  const readMaybeProjection = (threadId: ThreadId, projectId: ProjectId) =>
    readProjection(threadId, projectId).pipe(Effect.option);

  const validateLeadThread = Effect.fn("LeadService.validateLeadThread")(function* (input: {
    readonly projection: OrchestrationV2ThreadProjection;
    readonly projectId: ProjectId;
    readonly operation: string;
    readonly allowChild?: boolean | undefined;
  }) {
    const thread = input.projection.thread;
    if (thread.deletedAt !== null) {
      return yield* fail({
        operation: input.operation,
        reason: "thread_not_found",
        message: `Thread ${thread.id} was deleted.`,
        projectId: input.projectId,
      });
    }
    if (thread.projectId !== input.projectId) {
      return yield* fail({
        operation: input.operation,
        reason: "wrong_project",
        message: `Thread ${thread.id} belongs to another project.`,
        projectId: input.projectId,
      });
    }
    if (input.allowChild !== true && thread.lineage.relationshipToParent !== null) {
      return yield* fail({
        operation: input.operation,
        reason: "invalid_request",
        message: `Thread ${thread.id} is a child thread, not an ordinary project thread.`,
        projectId: input.projectId,
      });
    }
    if (thread.archivedAt !== null) {
      return yield* fail({
        operation: input.operation,
        reason: "thread_archived",
        message: `Thread ${thread.id} is archived.`,
        projectId: input.projectId,
      });
    }
  });

  const assertProjectThreads = Effect.fn("LeadService.assertProjectThreads")(function* (input: {
    readonly projectId: ProjectId;
    readonly threadIds: ReadonlyArray<ThreadId>;
    readonly operation: string;
  }) {
    for (const threadId of input.threadIds) {
      const projection = yield* readProjection(threadId, input.projectId);
      yield* validateLeadThread({
        projection,
        projectId: input.projectId,
        operation: input.operation,
        allowChild: true,
      });
    }
  });

  const bind = Effect.fn("LeadService.bind")(function* (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly workerDefault?: ProjectLeadWorkerFinish | undefined;
  }) {
    const settings = yield* settingsService
      .updateSettings({
        projectLeadConfigs: {
          [input.projectId]: {
            threadId: input.threadId,
            ...(input.workerDefault === undefined ? {} : { workerDefault: input.workerDefault }),
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "binding-write",
              reason: "orchestration_error",
              message: `Lead binding for project ${input.projectId} could not be stored.`,
              projectId: input.projectId,
              cause,
            }),
        ),
      );
    const binding = settings.projectLeadConfigs[input.projectId];
    if (binding === undefined) {
      return yield* fail({
        operation: "binding-write",
        reason: "orchestration_error",
        message: `Lead binding for project ${input.projectId} was not stored.`,
        projectId: input.projectId,
      });
    }
    return binding;
  });

  const resolveNewLeadModel = Effect.fn("LeadService.resolveNewLeadModel")(function* (input: {
    readonly settings: ServerSettings;
    readonly projectId: ProjectId;
    readonly projectDefault: ModelSelection | null;
    readonly explicit: ModelSelection | undefined;
  }) {
    const policy = resolveAgentRoleModel({
      settings: input.settings,
      projectId: input.projectId,
      role: "lead",
      explicit: input.explicit,
    });
    if (policy !== null) return policy;
    const fallback = input.projectDefault ?? input.settings.defaultModelSelection;
    if (fallback === null) {
      return yield* fail({
        operation: "ensure",
        reason: "model_unavailable",
        message: `Project ${input.projectId} has no lead model configured.`,
        projectId: input.projectId,
      });
    }
    return { modelSelection: fallback, source: "thread_inheritance" as const };
  });

  const ensure: LeadService["Service"]["ensure"] = Effect.fn("LeadService.ensure")(
    function* (input) {
      const project = yield* requireProject(input.projectId);
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "ensure",
              reason: "orchestration_error",
              message: `Settings for project ${input.projectId} could not be read.`,
              projectId: input.projectId,
              cause,
            }),
        ),
      );
      const stored = settings.projectLeadConfigs[input.projectId];

      if (input.existingThreadId !== undefined && stored !== undefined) {
        return yield* fail({
          operation: "ensure",
          reason: "invalid_request",
          message: `Project ${input.projectId} already has lead thread ${stored.threadId}; configure the binding instead of appointing another thread.`,
          projectId: input.projectId,
        });
      }

      const candidateThreadId = input.existingThreadId ?? stored?.threadId;
      if (candidateThreadId !== undefined) {
        const projection = yield* readProjection(candidateThreadId, input.projectId);
        yield* validateLeadThread({ projection, projectId: input.projectId, operation: "ensure" });
        const binding =
          stored?.threadId === candidateThreadId
            ? stored
            : yield* bind({ projectId: input.projectId, threadId: candidateThreadId });
        if (
          input.modelSelection !== undefined &&
          !modelSelectionsEqual(input.modelSelection, projection.thread.modelSelection)
        ) {
          return yield* fail({
            operation: "ensure",
            reason: "invalid_request",
            message: `Thread ${candidateThreadId} already uses ${projection.thread.modelSelection.model}; model switching is a separate thread action.`,
            projectId: input.projectId,
          });
        }
        return {
          projectId: input.projectId,
          threadId: candidateThreadId,
          created: false,
          modelSelection: projection.thread.modelSelection,
          policySource: input.modelSelection === undefined ? "thread_inheritance" : "explicit",
          binding,
          thread: summaryOf(
            projection.thread,
            projection.runs.some(ThreadManagementService.isActiveRun),
          ),
        };
      }

      const providerList = yield* providerRegistry.getProviders.pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "ensure",
              reason: "orchestration_error",
              message: `Providers could not be read for project ${input.projectId}.`,
              projectId: input.projectId,
              cause,
            }),
        ),
      );
      const resolved = yield* resolveNewLeadModel({
        settings,
        projectId: input.projectId,
        projectDefault: project.defaultModelSelection,
        explicit: input.modelSelection,
      });
      yield* validateRoleSelection({
        settings,
        projectId: input.projectId,
        selection: resolved.modelSelection,
        providers: providerList,
      });

      const derivedThreadId = ThreadId.make(leadThreadIdForProject(input.projectId));
      const existingDerived = yield* readMaybeProjection(derivedThreadId, input.projectId);
      if (Option.isSome(existingDerived)) {
        yield* validateLeadThread({
          projection: existingDerived.value,
          projectId: input.projectId,
          operation: "ensure",
        });
        const binding = yield* bind({ projectId: input.projectId, threadId: derivedThreadId });
        return {
          projectId: input.projectId,
          threadId: derivedThreadId,
          created: false,
          modelSelection: existingDerived.value.thread.modelSelection,
          policySource: resolved.source,
          binding,
          thread: summaryOf(
            existingDerived.value.thread,
            existingDerived.value.runs.some(ThreadManagementService.isActiveRun),
          ),
        };
      }

      const commandId = CommandId.make(`lead:ensure:${input.requestId}`);
      const launched = yield* threadLaunch
        .launch({
          commandId,
          threadId: derivedThreadId,
          projectId: input.projectId,
          title: LEAD_TITLE,
          modelSelection: resolved.modelSelection,
          runtimeMode: settings.defaultRuntimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "server",
        })
        .pipe(
          Effect.flatMap((result) =>
            bind({ projectId: input.projectId, threadId: result.threadId }).pipe(
              Effect.map((binding) => ({
                threadId: result.threadId,
                projection: result.projection,
                binding,
                created: true,
              })),
            ),
          ),
          Effect.catch((cause) =>
            Effect.gen(function* () {
              // Thread creation commits before the settings write. A retry must adopt the
              // thread it already made instead of creating or routing to another one.
              const recovered = yield* readMaybeProjection(derivedThreadId, input.projectId);
              if (Option.isSome(recovered)) {
                yield* validateLeadThread({
                  projection: recovered.value,
                  projectId: input.projectId,
                  operation: "ensure",
                });
                const binding = yield* bind({
                  projectId: input.projectId,
                  threadId: derivedThreadId,
                });
                return {
                  threadId: derivedThreadId,
                  projection: recovered.value,
                  binding,
                  created: false,
                };
              }
              return yield* new LeadRpcError({
                operation: "ensure",
                reason: "orchestration_error",
                message: `Lead thread for project ${input.projectId} could not be created.`,
                projectId: input.projectId,
                cause,
              });
            }),
          ),
        );
      return {
        projectId: input.projectId,
        threadId: launched.threadId,
        created: launched.created,
        modelSelection: launched.projection.thread.modelSelection,
        policySource: resolved.source,
        binding: launched.binding,
        thread: summaryOf(
          launched.projection.thread,
          launched.projection.runs.some(ThreadManagementService.isActiveRun),
        ),
      };
    },
  );

  const read: LeadService["Service"]["read"] = Effect.fn("LeadService.read")(function* (input) {
    yield* requireProject(input.projectId);
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new LeadRpcError({
            operation: "read",
            reason: "orchestration_error",
            message: `Settings for project ${input.projectId} could not be read.`,
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    const binding = settings.projectLeadConfigs[input.projectId] ?? null;
    if (binding === null) {
      return {
        projectId: input.projectId,
        binding: null,
        bindingStatus: "ok",
        thread: null,
        state: null,
        pendingHandoffCount: 0,
        workerDefault: "handoff",
        roleModels: effectiveAgentRoleModels(settings, input.projectId),
      };
    }
    const projection = yield* readMaybeProjection(binding.threadId, input.projectId);
    if (Option.isNone(projection)) {
      return {
        projectId: input.projectId,
        binding,
        bindingStatus: "missing_thread",
        thread: null,
        state: null,
        pendingHandoffCount: 0,
        workerDefault: binding.workerDefault,
        roleModels: effectiveAgentRoleModels(settings, input.projectId),
      };
    }
    const thread = projection.value.thread;
    const status =
      thread.projectId !== input.projectId
        ? ("wrong_project" as const)
        : thread.archivedAt !== null
          ? ("archived" as const)
          : ("ok" as const);
    const state = thread.leadState ?? null;
    return {
      projectId: input.projectId,
      binding,
      bindingStatus: status,
      thread:
        status === "ok"
          ? summaryOf(thread, projection.value.runs.some(ThreadManagementService.isActiveRun))
          : null,
      state,
      pendingHandoffCount: state?.handoffs.length ?? 0,
      workerDefault: binding.workerDefault,
      roleModels: effectiveAgentRoleModels(settings, input.projectId),
    };
  });

  const send: LeadService["Service"]["send"] = Effect.fn("LeadService.send")(function* (input) {
    const ensured = yield* ensure({
      projectId: input.projectId,
      requestId: `send:${input.commandId}`,
    });
    const result = yield* threads
      .sendToThread({
        projectId: input.projectId,
        commandId: input.commandId,
        threadId: ensured.threadId,
        messageId: input.messageId,
        text: input.text,
        attachments: [],
        mode: input.mode ?? "auto",
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "send",
              reason:
                cause._tag === "ThreadManagementThreadArchivedError"
                  ? "thread_archived"
                  : "orchestration_error",
              message: `Lead send to thread ${ensured.threadId} failed.`,
              projectId: input.projectId,
              cause,
            }),
        ),
      );
    return {
      projectId: input.projectId,
      threadId: ensured.threadId,
      commandId: input.commandId,
      messageId: input.messageId,
      runId: result.run.id,
      sequence: result.dispatch.sequence,
      delivery: result.delivery,
    };
  });

  const configure: LeadService["Service"]["configure"] = Effect.fn("LeadService.configure")(
    function* (input) {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "configure",
              reason: "orchestration_error",
              message: `Settings for project ${input.projectId} could not be read.`,
              projectId: input.projectId,
              cause,
            }),
        ),
      );
      const stored = settings.projectLeadConfigs[input.projectId];
      if (input.existingThreadId !== undefined) {
        const projection = yield* readProjection(input.existingThreadId, input.projectId);
        yield* validateLeadThread({
          projection,
          projectId: input.projectId,
          operation: "configure",
        });
      }
      const wantsBinding =
        input.existingThreadId !== undefined ||
        input.workerDefault !== undefined ||
        input.workerFinishOverrides !== undefined;
      const targetThreadId = input.existingThreadId ?? stored?.threadId;
      if (wantsBinding && targetThreadId === undefined) {
        return yield* fail({
          operation: "configure",
          reason: "invalid_request",
          message: `Project ${input.projectId} has no lead thread to configure.`,
          projectId: input.projectId,
        });
      }

      let overridesPatch: Record<ThreadId, ProjectLeadWorkerFinish | null> | undefined;
      if (input.workerFinishOverrides === null) {
        overridesPatch = Object.fromEntries(
          Object.keys(stored?.workerFinishOverrides ?? {}).map((threadId) => [threadId, null]),
        ) as Record<ThreadId, ProjectLeadWorkerFinish | null>;
      } else if (input.workerFinishOverrides !== undefined) {
        overridesPatch = input.workerFinishOverrides as Record<
          ThreadId,
          ProjectLeadWorkerFinish | null
        >;
      }

      if (overridesPatch !== undefined) {
        yield* assertProjectThreads({
          projectId: input.projectId,
          threadIds: Object.entries(overridesPatch)
            .filter(([, mode]) => mode !== null)
            .map(([threadId]) => ThreadId.make(threadId)),
          operation: "configure",
        });
      }

      const updated = yield* settingsService
        .updateSettings({
          ...(input.roleModels === undefined ? {} : { agentRoleModels: input.roleModels }),
          ...(input.projectRoleModels === undefined
            ? {}
            : {
                projectAgentRoleModels: {
                  [input.projectId]: input.projectRoleModels,
                },
              }),
          ...(wantsBinding && targetThreadId !== undefined
            ? {
                projectLeadConfigs: {
                  [input.projectId]: {
                    ...(targetThreadId === input.existingThreadId
                      ? { threadId: targetThreadId }
                      : {}),
                    ...(input.workerDefault === undefined
                      ? {}
                      : { workerDefault: input.workerDefault }),
                    ...(overridesPatch === undefined
                      ? {}
                      : { workerFinishOverrides: overridesPatch }),
                  },
                },
              }
            : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new LeadRpcError({
                operation: "configure",
                reason: "orchestration_error",
                message: `Lead configuration for project ${input.projectId} could not be stored.`,
                projectId: input.projectId,
                cause,
              }),
          ),
        );
      return {
        projectId: input.projectId,
        binding: updated.projectLeadConfigs[input.projectId] ?? null,
        roleModels: effectiveAgentRoleModels(updated, input.projectId),
      };
    },
  );

  const writeLeadState = Effect.fn("LeadService.writeLeadState")(function* (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly operation: string;
    readonly retryOnStale: boolean;
    readonly update: (state: LeadState | null) => Effect.Effect<LeadState | null, LeadRpcError>;
  }) {
    const attempts = input.retryOnStale ? MAX_CAS_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const projection = yield* readProjection(input.threadId, input.projectId);
      const current = projection.thread.leadState ?? null;
      const next = yield* input.update(current);
      if (current !== null && next !== null && next.revision === current.revision) {
        return { state: current };
      }
      const nextRevision = (current?.revision ?? 0) + 1;
      if (current === null && next === null) return { state: null };
      const committed: LeadState | null =
        next === null ? null : { ...next, revision: nextRevision };
      const dispatched = yield* threads
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`lead:${input.operation}:${input.threadId}:${nextRevision}`),
          threadId: input.threadId,
          leadState: committed,
          expectedLeadRevision: current?.revision ?? 0,
        })
        .pipe(Effect.result);
      if (Result.isSuccess(dispatched)) return { state: committed };
      if (input.retryOnStale && isStaleDispatchError(dispatched.failure)) continue;
      const writeError = isStaleDispatchError(dispatched.failure)
        ? fail({
            operation: input.operation,
            reason: "stale_revision",
            message: `Lead state for thread ${input.threadId} changed.`,
            projectId: input.projectId,
          })
        : new LeadRpcError({
            operation: input.operation,
            reason: "orchestration_error",
            message: `Lead state for thread ${input.threadId} could not be stored.`,
            projectId: input.projectId,
            cause: dispatched.failure,
          });
      return yield* writeError;
    }
    return yield* fail({
      operation: input.operation,
      reason: "stale_revision",
      message: `Lead state for thread ${input.threadId} kept changing; retry.`,
      projectId: input.projectId,
    });
  });

  const resolveHandoffHead = (input: {
    readonly cwd: string;
    readonly reported: string | undefined;
  }) =>
    git.resolveCommit({ cwd: input.cwd, revision: "HEAD" }).pipe(
      Effect.option,
      Effect.map((resolved) => {
        const resolvedSha = Option.isSome(resolved) ? resolved.value.commitSha : null;
        if (
          resolvedSha !== null &&
          input.reported !== undefined &&
          resolvedSha !== input.reported
        ) {
          return { head: null, source: null, mismatch: true as const };
        }
        if (resolvedSha !== null) {
          return { head: resolvedSha, source: "resolved" as const, mismatch: false as const };
        }
        return input.reported === undefined
          ? { head: null, source: null, mismatch: false as const }
          : { head: input.reported, source: "reported" as const, mismatch: false as const };
      }),
    );

  const handoff: LeadService["Service"]["handoff"] = Effect.fn("LeadService.handoff")(
    function* (request) {
      const input = request.input;
      if (input.sourceThreadId !== undefined && input.sourceThreadId !== request.callerThreadId) {
        return yield* fail({
          operation: "handoff",
          reason: "invalid_request",
          message: "A worker may only hand off its own thread.",
        });
      }
      const source = yield* readThreadProjection(request.callerThreadId);
      const projectId = source.thread.projectId;
      yield* validateLeadThread({
        projection: source,
        projectId,
        operation: "handoff",
        allowChild: true,
      });
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "handoff",
              reason: "orchestration_error",
              message: `Settings for project ${projectId} could not be read.`,
              projectId,
              cause,
            }),
        ),
      );
      const binding = settings.projectLeadConfigs[projectId];
      if (binding === undefined) {
        return yield* fail({
          operation: "handoff",
          reason: "invalid_request",
          message: `Project ${projectId} has no lead thread.`,
          projectId,
        });
      }
      if (binding.threadId === source.thread.id) {
        return yield* fail({
          operation: "handoff",
          reason: "invalid_request",
          message: "A lead thread does not hand work off to itself.",
          projectId,
        });
      }
      const leadProjection = yield* readProjection(binding.threadId, projectId);
      yield* validateLeadThread({
        projection: leadProjection,
        projectId,
        operation: "handoff",
      });

      // The binding is durable; lead state first appears with this record.
      const latestRun = source.runs.toSorted((left, right) => right.ordinal - left.ordinal)[0];
      const sourceRun =
        input.sourceRunId === undefined
          ? latestRun
          : source.runs.find((run) => run.id === input.sourceRunId);
      if (sourceRun === undefined) {
        return yield* fail({
          operation: "handoff",
          reason: "invalid_request",
          message: `Thread ${source.thread.id} has no run to hand off.`,
          projectId,
        });
      }

      const project = yield* requireProject(projectId);
      const head = yield* resolveHandoffHead({
        cwd: source.thread.worktreePath ?? project.workspaceRoot,
        reported: input.head,
      });
      if (head.mismatch) {
        return yield* fail({
          operation: "handoff",
          reason: "invalid_request",
          message: `Reported head does not match the checked-out commit for thread ${source.thread.id}.`,
          projectId,
        });
      }
      const handoffId = `handoff:${sourceRun.id}:${head.head ?? "no-head"}`;
      const createdAt = yield* nowIso;
      const candidate: LeadHandoff = {
        id: handoffId,
        sourceThreadId: source.thread.id,
        sourceRunId: sourceRun.id,
        head: head.head,
        headSource: head.source,
        summary: input.summary,
        checks: input.checks,
        reviewStatus: "review_required",
        status: "reported",
        createdAt,
      };

      let created = true;
      const written = yield* writeLeadState({
        projectId,
        threadId: binding.threadId,
        operation: "handoff",
        retryOnStale: true,
        update: (current) => {
          const next = appendLeadHandoff(current, candidate);
          created = next.created;
          return Effect.succeed(next.created ? next.state : current);
        },
      });
      const existing = written.state?.handoffs.find(
        (entry) => entry.sourceRunId === candidate.sourceRunId && entry.head === candidate.head,
      );
      if (existing === undefined) {
        return yield* fail({
          operation: "handoff",
          reason: "orchestration_error",
          message: `Handoff for run ${sourceRun.id} was not recorded.`,
          projectId,
        });
      }
      return {
        projectId,
        leadThreadId: binding.threadId,
        handoff: existing,
        created,
        revision: written.state?.revision ?? 0,
        pendingHandoffCount: written.state?.handoffs.length ?? 0,
      };
    },
  );

  const status: LeadService["Service"]["status"] = Effect.fn("LeadService.status")(
    function* (input) {
      const caller =
        input.callerThreadId === null ? null : yield* readThreadProjection(input.callerThreadId);
      const projectId = input.projectId ?? caller?.thread.projectId;
      if (projectId === undefined) {
        return yield* fail({
          operation: "status",
          reason: "invalid_request",
          message: "A lead status read needs a project or a calling thread.",
        });
      }
      if (caller !== null && caller.thread.projectId !== projectId) {
        return yield* fail({
          operation: "status",
          reason: "wrong_project",
          message: `The calling thread belongs to another project.`,
          projectId,
        });
      }
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new LeadRpcError({
              operation: "status",
              reason: "orchestration_error",
              message: `Settings for project ${projectId} could not be read.`,
              projectId,
              cause,
            }),
        ),
      );
      const binding = settings.projectLeadConfigs[projectId] ?? null;
      if (binding === null) {
        return {
          projectId,
          binding: null,
          bindingStatus: "ok",
          workerDefault: "handoff",
          pendingHandoffs: [],
          ownership: null,
          revision: null,
        };
      }
      const lead = yield* readMaybeProjection(binding.threadId, projectId);
      if (Option.isNone(lead)) {
        return {
          projectId,
          binding,
          bindingStatus: "missing_thread",
          workerDefault: binding.workerDefault,
          pendingHandoffs: [],
          ownership: null,
          revision: null,
        };
      }
      const thread = lead.value.thread;
      const bindingStatus =
        thread.projectId !== projectId
          ? ("wrong_project" as const)
          : thread.archivedAt !== null
            ? ("archived" as const)
            : ("ok" as const);
      const state = thread.leadState ?? null;
      return {
        projectId,
        binding,
        bindingStatus,
        workerDefault: binding.workerDefault,
        pendingHandoffs: state?.handoffs ?? [],
        ownership: state?.ownership ?? null,
        revision: state?.revision ?? null,
      };
    },
  );

  const authorityUpdate = Effect.fn("LeadService.authorityUpdate")(function* (input: {
    readonly operation: string;
    readonly projectId: ProjectId;
    readonly expectedRevision: number;
    readonly update: (state: LeadState | null) => Effect.Effect<LeadState, LeadRpcError>;
  }) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new LeadRpcError({
            operation: input.operation,
            reason: "orchestration_error",
            message: `Settings for project ${input.projectId} could not be read.`,
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    const binding = settings.projectLeadConfigs[input.projectId];
    if (binding === undefined) {
      return yield* fail({
        operation: input.operation,
        reason: "invalid_request",
        message: `Project ${input.projectId} has no lead thread.`,
        projectId: input.projectId,
      });
    }
    const projection = yield* readProjection(binding.threadId, input.projectId);
    const currentRevision = projection.thread.leadState?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      return yield* fail({
        operation: input.operation,
        reason: "stale_revision",
        message: `Lead state for thread ${binding.threadId} changed.`,
        projectId: input.projectId,
      });
    }
    const written = yield* writeLeadState({
      projectId: input.projectId,
      threadId: binding.threadId,
      operation: input.operation,
      retryOnStale: false,
      update: (state) => input.update(state),
    });
    return {
      projectId: input.projectId,
      leadThreadId: binding.threadId,
      revision: written.state?.revision ?? 0,
      ownership: written.state?.ownership ?? null,
    };
  });

  const grant: LeadService["Service"]["grant"] = Effect.fn("LeadService.grant")(function* (input) {
    if (input.scope.type === "threads") {
      yield* assertProjectThreads({
        projectId: input.projectId,
        threadIds: input.scope.threadIds,
        operation: "grant",
      });
    }
    const grantedAt = yield* nowIso;
    const grantRecord: LeadOwnershipGrant = {
      id: `grant:${input.projectId}:${input.expectedRevision + 1}`,
      scope: input.scope,
      actions: input.actions,
      grantedAt,
      revokedAt: null,
    };
    return yield* authorityUpdate({
      operation: "grant",
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      update: (state) => {
        if (state?.ownership?.revokedAt === null) {
          return Effect.fail(
            fail({
              operation: "grant",
              reason: "invalid_request",
              message: `Lead thread already holds an active ownership grant.`,
              projectId: input.projectId,
            }),
          );
        }
        return Effect.succeed({
          revision: state?.revision ?? 0,
          handoffs: state?.handoffs ?? [],
          ownership: grantRecord,
        });
      },
    });
  });

  const revoke: LeadService["Service"]["revoke"] = Effect.fn("LeadService.revoke")(
    function* (input) {
      const revokedAt = yield* nowIso;
      return yield* authorityUpdate({
        operation: "revoke",
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        update: (state) => {
          const active = state?.ownership;
          if (active === null || active === undefined || active.id !== input.grantId) {
            return Effect.fail(
              fail({
                operation: "revoke",
                reason: "ownership_missing",
                message: `Lead thread has no active grant ${input.grantId}.`,
                projectId: input.projectId,
              }),
            );
          }
          if (active.revokedAt !== null) {
            return Effect.fail(
              fail({
                operation: "revoke",
                reason: "ownership_missing",
                message: `Grant ${input.grantId} was already revoked.`,
                projectId: input.projectId,
              }),
            );
          }
          return Effect.succeed({
            revision: state?.revision ?? 0,
            handoffs: state?.handoffs ?? [],
            ownership: { ...active, revokedAt },
          });
        },
      });
    },
  );

  return {
    ensure,
    read,
    send,
    configure,
    handoff,
    status,
    grant,
    revoke,
  } satisfies LeadService["Service"];
});

export const layer = Layer.effect(LeadService, make);
