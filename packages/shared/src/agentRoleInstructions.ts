import type { AgentRole, ModelSelection, ProjectId, ServerSettings } from "@t3tools/contracts";

import {
  DELEGABLE_AGENT_ROLES,
  hasDelegableAgentRolePolicy,
  resolveAgentRoleModel,
  type DelegableAgentRole,
} from "./agentRolePolicy.ts";

/**
 * Production built-ins. Each describes an expert identity and quality bar only;
 * ownership and finishing rules belong to the extension that needs them.
 */
export const AGENT_ROLE_INSTRUCTION_DEFAULTS = {
  architecture:
    "You are a principal software architect. Find the real constraint, then design the simplest structure that makes the correct behavior obvious. Name boundaries, data flow and tradeoffs plainly, and prefer removing complexity to adding machinery.",
  implementation:
    "You are a senior engineer shipping production code you would sign your name to. Read the surrounding code first, match its patterns, and make the change small, correct and complete. Verify what you changed before you call it done.",
  research:
    "You are an expert investigator. Go to primary sources: the code, the docs, the actual behavior. Answer the question asked, separate what you confirmed from what you infer, and say where each finding came from.",
  review:
    "You are a meticulous senior reviewer. Hunt for real defects: wrong behavior, missed edge cases, races, security gaps, paths left unhandled. Check each finding against the source before reporting it, rank by severity, and skip style nits unless asked.",
  security:
    "You are an expert security researcher and application security engineer. Treat this as a rigorous adversarial assessment and hardening review: trace trust boundaries and real attack paths, look beyond surface-level findings, and pursue the depth of work you would defend in a professional security audit. Prioritize reproducible vulnerabilities by impact and exploitability, distinguish confirmed findings from hypotheses, and propose concrete fixes and verification steps. Be relentless about evidence and thorough within the assigned scope.",
  design:
    "You are an expert motion designer, product designer, animator, and video editor. Treat this as a showreel for your resume. Go all out.",
  test: "You are an expert test engineer. Write tests that fail for the right reason: real behavior and real edge cases, not mirrors of the implementation or timing-dependent checks. Report exactly what ran and what it showed.",
  general:
    "You are a versatile senior engineer. Understand the goal before acting, do the work to a high standard, and say plainly what you did, what you didn't, and why.",
} satisfies Record<AgentRole, string>;

const AGENT_ROLE_TITLES: Readonly<Record<AgentRole, string>> = {
  architecture: "Architecture",
  implementation: "Implementation",
  research: "Research",
  review: "Review",
  security: "Security",
  design: "Design",
  test: "Test",
  general: "General",
};

export type AgentRoleInstructionSource = "project" | "environment" | "built_in";

export interface ResolvedAgentRoleInstruction {
  readonly text: string;
  readonly source: AgentRoleInstructionSource;
}

function agentRoleTitle(role: AgentRole): string {
  return AGENT_ROLE_TITLES[role];
}

/**
 * Project key, then environment key, then the built-in. An absent key inherits;
 * an explicit "" is a value that disables the extra block. No trimming.
 */
export function resolveAgentRoleInstruction(input: {
  readonly settings: Pick<ServerSettings, "agentRoleInstructions" | "projectSettingsOverrides">;
  readonly projectId: ProjectId;
  readonly role: AgentRole;
}): ResolvedAgentRoleInstruction {
  const projectText =
    input.settings.projectSettingsOverrides[input.projectId]?.agentRoleInstructions?.[input.role];
  if (projectText !== undefined) {
    return { text: projectText, source: "project" };
  }
  const environmentText = input.settings.agentRoleInstructions[input.role];
  if (environmentText !== undefined) {
    return { text: environmentText, source: "environment" };
  }
  return { text: AGENT_ROLE_INSTRUCTION_DEFAULTS[input.role], source: "built_in" };
}

/**
 * T3-owned framing keeps "go all out" about craft: it cannot widen the task,
 * grant permissions, or ask for more agents. An explicit "" omits the block.
 */
export function formatAgentRoleInstruction(role: AgentRole, text: string): string | null {
  if (text === "") return null;
  return [
    `## Role: ${agentRoleTitle(role)}`,
    "These instructions set your standard of work. They don't widen your task, grant permissions, or ask you to start other agents.",
    "",
    text,
  ].join("\n");
}

const DELEGABLE_ROLE_SCOPES: Readonly<Record<DelegableAgentRole, string>> = {
  architecture: "System design, boundaries, data flow, and technical tradeoffs.",
  implementation: "Production code changes, fixes, and refactors.",
  research: "Investigate code, docs, and observed behavior from primary sources.",
  review: "Code review for correctness, edge cases, races, security, and missing paths.",
  security:
    "Security research, threat modeling, vulnerability assessment, auth and trust-boundary review, and hardening.",
  design: "UI, interaction, visual, motion, and design-quality work or audits.",
  test: "Test design, failure cases, and coverage.",
  general: "Work that does not fit a distinct role above.",
};

function formatModelOptions(options: ModelSelection["options"]): string {
  if (options === undefined) return "";
  const entries: ReadonlyArray<readonly [string, string | boolean]> = Array.isArray(options)
    ? options.map((option) => [option.id, option.value] as const)
    : Object.entries(options);
  return entries.length === 0
    ? ""
    : `, options ${entries.map(([id, value]) => `${id}=${String(value)}`).join(", ")}`;
}

/**
 * A compact per-turn catalog for an ordinary parent: which delegable roles
 * exist, what this project's effective policy configures, and that only a T3
 * managed `delegate_task(role)` applies that policy. Full role pre-prompts stay
 * on the child and are never repeated here.
 */
export function formatAgentRoleCatalog(input: {
  readonly settings: Pick<
    ServerSettings,
    "agentRoleModels" | "agentRoleInstructions" | "projectSettingsOverrides"
  >;
  readonly projectId: ProjectId;
}): string | null {
  if (!hasDelegableAgentRolePolicy(input)) return null;
  const entries = DELEGABLE_AGENT_ROLES.map((role) => {
    const model = resolveAgentRoleModel({
      settings: input.settings,
      projectId: input.projectId,
      role,
    });
    const instruction = resolveAgentRoleInstruction({
      settings: input.settings,
      projectId: input.projectId,
      role,
    });
    const configured: string[] = [];
    if (model !== null) {
      const source = model.source === "project_role" ? "project override" : "environment default";
      configured.push(
        `${model.modelSelection.instanceId}/${model.modelSelection.model}${formatModelOptions(model.modelSelection.options)} (${source})`,
      );
    }
    if (instruction.source !== "built_in") {
      configured.push(
        instruction.text === "" ? "role preamble disabled" : "custom role instructions",
      );
    }
    const detail = configured.length === 0 ? "" : ` Configured: ${configured.join("; ")}.`;
    return `- \`${role}\`: ${DELEGABLE_ROLE_SCOPES[role]}${detail}`;
  });
  return [
    "## Role delegation",
    "Choose the role from the work when you delegate. For a task that belongs to a role below, call `delegate_task` with `role`; T3 applies that role's configured model and instruction preamble to the child, and a native subagent cannot. A role changes the child's model and standard of work only: it never widens the task, grants permissions, or asks for extra agents. An explicit user-named model or provider still wins. Use a native tool only when no role applies or the user explicitly asks for native tooling. Omit `target` to use the role's configured model, or this thread's model when the role has none.",
    ...entries,
  ].join("\n");
}
