import * as Schema from "effect/Schema";

import { ModelSelection } from "./modelSelection.ts";

/**
 * Roles a delegable child may route to a model. Project coordination is not a
 * role here; it is an extension that adds its own entry to these sparse maps.
 */
export const AgentRole = Schema.Literals([
  "architecture",
  "implementation",
  "research",
  "review",
  "security",
  "design",
  "test",
  "general",
]);
export type AgentRole = typeof AgentRole.Type;

const AgentRoleKeys = {
  architecture: Schema.optionalKey(ModelSelection),
  implementation: Schema.optionalKey(ModelSelection),
  research: Schema.optionalKey(ModelSelection),
  review: Schema.optionalKey(ModelSelection),
  security: Schema.optionalKey(ModelSelection),
  design: Schema.optionalKey(ModelSelection),
  test: Schema.optionalKey(ModelSelection),
  general: Schema.optionalKey(ModelSelection),
} as const;

/** Sparse by design: an absent role inherits the next scope. Unknown role keys round-trip. */
export const AgentRoleModelSelections = Schema.StructWithRest(Schema.Struct(AgentRoleKeys), [
  Schema.Record(Schema.String, Schema.Unknown),
]);
export type AgentRoleModelSelections = typeof AgentRoleModelSelections.Type;

export const AgentRoleModelSelectionPatch = Schema.Struct({
  architecture: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  implementation: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  research: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  review: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  security: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  design: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  test: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  general: Schema.optionalKey(Schema.NullOr(ModelSelection)),
});
export type AgentRoleModelSelectionPatch = typeof AgentRoleModelSelectionPatch.Type;

/** Stored byte-for-byte; never trimmed or normalized. An empty string disables extra text. */
export const AGENT_ROLE_INSTRUCTION_MAX_LENGTH = 8_000;

const AgentRoleInstructionText = Schema.String.check(
  Schema.isMaxLength(AGENT_ROLE_INSTRUCTION_MAX_LENGTH),
);

const AgentRoleInstructionKeys = {
  architecture: Schema.optionalKey(AgentRoleInstructionText),
  implementation: Schema.optionalKey(AgentRoleInstructionText),
  research: Schema.optionalKey(AgentRoleInstructionText),
  review: Schema.optionalKey(AgentRoleInstructionText),
  security: Schema.optionalKey(AgentRoleInstructionText),
  design: Schema.optionalKey(AgentRoleInstructionText),
  test: Schema.optionalKey(AgentRoleInstructionText),
  general: Schema.optionalKey(AgentRoleInstructionText),
} as const;

/** Sparse by design: an absent role inherits the next scope. Unknown role keys round-trip. */
export const AgentRoleInstructions = Schema.StructWithRest(
  Schema.Struct(AgentRoleInstructionKeys),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type AgentRoleInstructions = typeof AgentRoleInstructions.Type;

export const AgentRoleInstructionPatch = Schema.Struct({
  architecture: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  implementation: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  research: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  review: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  security: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  design: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  test: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
  general: Schema.optionalKey(Schema.NullOr(AgentRoleInstructionText)),
});
export type AgentRoleInstructionPatch = typeof AgentRoleInstructionPatch.Type;

/**
 * Known-role map the server advertises so clients never show a bundled copy. Every
 * role the server knows is present; `security` is optional so an older eight-role
 * server still decodes on new clients. A missing key means that server cannot store it.
 */
export const AgentRoleInstructionDefaults = Schema.Struct({
  architecture: AgentRoleInstructionText,
  implementation: AgentRoleInstructionText,
  research: AgentRoleInstructionText,
  review: AgentRoleInstructionText,
  security: Schema.optionalKey(AgentRoleInstructionText),
  design: AgentRoleInstructionText,
  test: AgentRoleInstructionText,
  general: AgentRoleInstructionText,
});
export type AgentRoleInstructionDefaults = typeof AgentRoleInstructionDefaults.Type;

/** Where a T3-owned launch's role model came from, most specific first. */
export const AgentRoleModelPolicySource = Schema.Literals([
  "explicit",
  "project_role",
  "environment_role",
]);
export type AgentRoleModelPolicySource = typeof AgentRoleModelPolicySource.Type;

export const AgentRoleModelResolution = Schema.Struct({
  modelSelection: ModelSelection,
  source: AgentRoleModelPolicySource,
});
export type AgentRoleModelResolution = typeof AgentRoleModelResolution.Type;
