import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import { awaitServiceLauncherStop } from "../cloud/serviceLauncherClient.ts";
import * as ServerConfig from "../config.ts";
import { awaitLauncherLoss } from "../launcherWatch.ts";
import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import { resolveBaseDir } from "../os-jank.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as AutomaticPort from "./automaticPort.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const runServerCommand = Effect.fn("server.runServerCommand")(function* (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: ServerConfig.StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
    readonly rejectRunningServer?: boolean;
  },
) {
  // Before config resolution, which claims a port and creates directories.
  const { runServer } = yield* Effect.promise(() => import("../server.ts"));
  const logLevel = yield* GlobalFlag.LogLevel;
  const selectAutomaticPort = yield* AutomaticPort.make.pipe(Effect.provide(ProcessRunner.layer));
  const config = yield* resolveServerConfig(flags, logLevel, { ...options, selectAutomaticPort });
  const run = Effect.raceFirst(
    runServer.pipe(Effect.provideService(ServerConfig.ServerConfig, config)),
    awaitServiceLauncherStop().pipe(Effect.andThen(Effect.interrupt)),
  ).pipe(
    // Settings' Reclaim stops the server; repair once the database is closed, before the restart.
    Effect.ensuring(
      DatabaseMaintenance.runRequestedReclaim(config.dbPath).pipe(
        Effect.provide(DatabaseMaintenance.layer),
      ),
    ),
  );
  if (config.mode !== "desktop" || config.desktopBootstrapToken === undefined) return yield* run;
  return yield* Effect.raceFirst(
    run,
    awaitLauncherLoss().pipe(
      // End like SIGTERM does (interrupt-only exit, so the runtime forces process exit).
      Effect.andThen(Effect.interrupt),
    ),
  );
});

export const runDefaultServerCommand = Effect.fn("server.runDefaultServerCommand")(function* (
  flags: CliServerFlags,
) {
  if (Option.isSome(flags.cwd)) {
    const cwd = flags.cwd.value.trim();
    const fs = yield* FileSystem.FileSystem;
    const platform = yield* HostProcess.Platform;
    const explicitPath =
      cwd === "." ||
      cwd === ".." ||
      cwd === "~" ||
      /[/\\]/.test(cwd) ||
      (platform === "win32" && /^[a-z]:/i.test(cwd));
    if (!explicitPath && (!(yield* fs.exists(cwd)) || (yield* fs.stat(cwd)).type !== "Directory")) {
      return yield* new CliError.UserError({
        cause: cwd,
        userMessage: `Unknown command ${yield* encodeCommand(cwd)}. Use "t3 --help" for commands or an explicit path such as "t3 ./my-project" for a new directory.`,
      });
    }
  }
  return yield* runServerCommand(flags, { rejectRunningServer: true });
});

export const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Same as `t3`."),
  Command.unlisted,
  Command.withHandler((flags) => runServerCommand(flags, { rejectRunningServer: true })),
);

// Serve never bootstraps a project, so it does not offer the flag that asks for one.
const { autoBootstrapProjectFromCwd: _, ...serveCommandFlags } = sharedServerCommandFlags;

export const serveCommand = Command.make("serve", serveCommandFlags).pipe(
  Command.withShortDescription("Run T3 Code in this terminal, with no browser."),
  Command.withDescription(
    "Run T3 Code in this terminal without opening a browser, and print pairing details. The background service runs this. To set up access from your other devices, run `t3 up`.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(
      { ...flags, autoBootstrapProjectFromCwd: Option.none() },
      {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      },
    ),
  ),
);

const prepareTrial = Effect.fn("server.prepareTrial")(function* (
  flags: CliServerFlags & {
    readonly copyFrom: Option.Option<string>;
    readonly mapProvider: ReadonlyArray<string>;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const baseDir = yield* resolveBaseDir(
    Option.getOrElse(
      Option.filter(flags.baseDir, (value) => value.trim() !== ""),
      () => path.join(home, ".t3-trial"),
    ),
  );
  const upstreamHome = yield* resolveBaseDir(undefined);
  const source = yield* resolveBaseDir(Option.getOrUndefined(flags.copyFrom));
  const { assertSeparateSetupHome, copySetup, initializeFreshTrial } = yield* Effect.promise(
    () => import("../persistence/SetupCopy.ts"),
  );
  const { parseSetupCopyProviderMappings } = yield* Effect.promise(
    () => import("../persistence/SetupCopyProviders.ts"),
  );
  const providerMappings = yield* parseSetupCopyProviderMappings(flags.mapProvider);
  yield* assertSeparateSetupHome(upstreamHome, baseDir);
  const state = path.join(baseDir, "userdata");
  const explicitCopy = Option.isSome(flags.copyFrom) || flags.mapProvider.length > 0;
  const warning =
    "New conversations and settings changes in the trial won't sync back to T3 Code. Trial work defaults to separate Git worktrees. Choosing Local in project settings edits the original checkout.";
  if (
    explicitCopy ||
    (process.stdin.isTTY &&
      process.stdout.isTTY &&
      !(yield* fs.exists(state)) &&
      (yield* fs.exists(path.join(source, "userdata", "statev2.sqlite"))))
  ) {
    yield* Console.log(warning);
    const copy =
      explicitCopy ||
      (yield* Prompt.run(
        Prompt.Confirm({
          message: "Copy your T3 projects, conversation text, and preferences to try the fork?",
          initial: false,
        }),
      ));
    if (copy) {
      const result = yield* copySetup({
        sourceHome: source,
        targetHome: baseDir,
        providerMappings,
      });
      yield* Console.log(
        `Copied ${result.projects} projects and ${result.threads} conversations to ${baseDir}.`,
      );
    }
  }
  yield* initializeFreshTrial(baseDir);
  return {
    ...flags,
    baseDir: Option.some(baseDir),
    autoBootstrapProjectFromCwd: Option.orElse(flags.autoBootstrapProjectFromCwd, () =>
      Option.some(Option.isSome(flags.cwd)),
    ),
  };
});

export const trialCommand = Command.make("trial", {
  ...sharedServerCommandFlags,
  mapProvider: Flag.String("map-provider").pipe(
    Flag.atLeast(0),
    Flag.withDescription(
      "Choose and enable a standard trial provider for a copied selection (source=destination). Repeat for each replacement.",
    ),
  ),
  copyFrom: Flag.String("copy-from").pipe(
    Flag.optional,
    Flag.withDescription(
      "Copy from an existing T3 home into a fresh trial home without prompting.",
    ),
  ),
}).pipe(
  Command.withShortDescription("Try the fork in a separate T3 home."),
  Command.withDescription(
    "Use a separate T3 setup (default ~/.t3-trial). On first launch, optionally copy existing T3 projects and conversations. Later progress stays in the trial.",
  ),
  Command.withHandler((flags) => prepareTrial(flags).pipe(Effect.flatMap(runDefaultServerCommand))),
);
