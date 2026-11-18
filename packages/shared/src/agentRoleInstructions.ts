import type {
  AgentRole,
  AgentRoleDelegationMode,
  ModelSelection,
  ProjectId,
  ServerSettings,
} from "@t3tools/contracts";

import { activeAgentRoles, type DelegableAgentRole } from "./agentRolePolicy.ts";

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

const DELEGATION_MODE_TEXT: Readonly<Record<AgentRoleDelegationMode, string>> = {
  prefer:
    "Prefer delegation for substantive, scoped work; handle simple questions and small, contained changes directly.",
  always: "Always delegate actual work that matches this role, even when you could do it yourself.",
};

/**
 * A compact per-turn catalog for a top-level thread with at least one active
 * role. No effective model means no catalog; children and side chats get none.
 */
export function formatAgentRoleCatalog(input: {
  readonly settings: Pick<
    ServerSettings,
    | "agentRoleModels"
    | "agentRoleInstructions"
    | "agentRoleDelegationModes"
    | "projectSettingsOverrides"
  >;
  readonly projectId: ProjectId;
  /** True only for a top-level listed thread, never a child, native subagent, or side chat. */
  readonly topLevel: boolean;
}): string | null {
  if (!input.topLevel) return null;
  const roles = activeAgentRoles({ settings: input.settings, projectId: input.projectId });
  if (roles.length === 0) return null;
  const entries = roles.map((active) => {
    const instruction = resolveAgentRoleInstruction({
      settings: input.settings,
      projectId: input.projectId,
      role: active.role,
    });
    const source = active.source === "project_role" ? "project override" : "environment default";
    const configured = [
      `${active.modelSelection.instanceId}/${active.modelSelection.model}${formatModelOptions(active.modelSelection.options)} (${source})`,
    ];
    if (instruction.source !== "built_in") {
      configured.push(
        instruction.text === "" ? "role preamble disabled" : "custom role instructions",
      );
    }
    return `- \`${active.role}\`: ${DELEGABLE_ROLE_SCOPES[active.role]} ${DELEGATION_MODE_TEXT[active.delegationMode]} Configured: ${configured.join("; ")}.`;
  });
  return [
    "## Role delegation",
    "Before choosing to do work directly, check the configured roles below, then apply each role's mode: an `always` role takes actual matching work, so call `delegate_task` with `role`, while a `prefer` role leaves small, direct work to your judgment. An actual requested security audit or review matches `security`; a mere mention of security, or a simple explanatory question, does not. Only T3 applies the role's configured model and instructions to the child; a native subagent cannot. The user's explicit instruction wins: a named model or provider overrides the role's model, a request to do the work in this thread skips delegation, and a request for native tooling uses your native tool. A role changes the child's model and standard of work only: it never widens the task, grants permissions, or asks for extra agents. Omit `target` to use the role's configured model.",
    ...entries,
  ].join("\n");
}
