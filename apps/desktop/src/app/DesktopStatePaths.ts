import * as Option from "effect/Option";

import { ROLES_PREVIEW_DISTRIBUTION, type DesktopDistribution } from "./DesktopDistribution.ts";

export type JoinPath = (first: string, ...segments: string[]) => string;

const DEFAULT_T3_HOME_DIRECTORY = ".t3";
const ROLES_PREVIEW_T3_HOME_DIRECTORY = ".t3-roles-preview";

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
  readonly distribution?: DesktopDistribution | null;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.t3Home), () =>
    input.joinPath(
      input.homeDirectory,
      input.distribution === ROLES_PREVIEW_DISTRIBUTION
        ? ROLES_PREVIEW_T3_HOME_DIRECTORY
        : DEFAULT_T3_HOME_DIRECTORY,
    ),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
