// @effect-diagnostics nodeBuiltinImport:off - Pre-ready Electron setup and the main module read the staged package.json before app services exist.
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

/** Written into the staged package.json by `--distribution roles-preview`. */
export const ROLES_PREVIEW_DISTRIBUTION = "roles-preview";
export type DesktopDistribution = typeof ROLES_PREVIEW_DISTRIBUTION;

// Absent on every normal build, which must keep behaving exactly as it did before distributions existed.
const DesktopAppPackageMetadata = Schema.Struct({
  t3codeCommitHash: Schema.optional(Schema.String),
  t3codeDistribution: Schema.optional(Schema.Literal(ROLES_PREVIEW_DISTRIBUTION)),
});

export const decodeDesktopAppPackageMetadata = Schema.decodeEffect(
  Schema.fromJsonString(DesktopAppPackageMetadata),
);

const decodeDesktopAppPackageMetadataSync = Schema.decodeSync(
  Schema.fromJsonString(DesktopAppPackageMetadata),
);

/**
 * Roles Preview keeps usage data off unless the tester's own environment sets a value, so an
 * explicit `T3CODE_TELEMETRY_ENABLED` still opts back in. Normal builds keep the upstream default.
 */
export function defaultsTelemetryOff(input: {
  readonly distribution: DesktopDistribution | null;
  /** The value the tester's environment supplies, when it supplies one. */
  readonly userValue: string | null | undefined;
}): boolean {
  return input.distribution === ROLES_PREVIEW_DISTRIBUTION && (input.userValue ?? "").trim() === "";
}

/** Null for a normal build, a missing package.json, or metadata this build cannot decode. */
export function readDesktopDistribution(input: {
  readonly appRoot: string;
  readonly readFileString: (filePath: string) => string;
}): DesktopDistribution | null {
  try {
    const metadata = decodeDesktopAppPackageMetadataSync(
      input.readFileString(NodePath.join(input.appRoot, "package.json")),
    );
    return metadata.t3codeDistribution ?? null;
  } catch {
    return null;
  }
}
