import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_ROLE_INSTRUCTION_DEFAULTS,
  formatAgentRoleCatalog,
  formatAgentRoleInstruction,
  resolveAgentRoleInstruction,
} from "./agentRoleInstructions.ts";

const projectId = ProjectId.make("project-a");

const settings = (overrides: Partial<ServerSettings> = {}): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  ...overrides,
});

describe("agent role instruction defaults", () => {
  it("ships the exact design and security defaults and a complete known-role map", () => {
    expect(AGENT_ROLE_INSTRUCTION_DEFAULTS.design).toBe(
      "You are an expert motion designer, product designer, animator, and video editor. Treat this as a showreel for your resume. Go all out.",
    );
    expect(AGENT_ROLE_INSTRUCTION_DEFAULTS.security).toBe(
      "You are an expert security researcher and application security engineer. Treat this as a rigorous adversarial assessment and hardening review: trace trust boundaries and real attack paths, look beyond surface-level findings, and pursue the depth of work you would defend in a professional security audit. Prioritize reproducible vulnerabilities by impact and exploitability, distinguish confirmed findings from hypotheses, and propose concrete fixes and verification steps. Be relentless about evidence and thorough within the assigned scope.",
    );
    expect(Object.keys(AGENT_ROLE_INSTRUCTION_DEFAULTS).toSorted()).toEqual(
      [
        "architecture",
        "design",
        "general",
        "implementation",
        "research",
        "review",
        "security",
        "test",
      ].toSorted(),
    );
    for (const text of Object.values(AGENT_ROLE_INSTRUCTION_DEFAULTS)) {
      expect(text.trim()).not.toBe("");
    }
  });
});

describe("resolveAgentRoleInstruction", () => {
  it("prefers a project override, then the environment, then the built-in", () => {
    expect(
      resolveAgentRoleInstruction({
        settings: settings({
          agentRoleInstructions: { review: "environment text" },
          projectSettingsOverrides: {
            [projectId]: { agentRoleInstructions: { review: "project text" } },
          },
        }),
        projectId,
        role: "review",
      }),
    ).toEqual({ text: "project text", source: "project" });

    expect(
      resolveAgentRoleInstruction({
        settings: settings({ agentRoleInstructions: { review: "environment text" } }),
        projectId,
        role: "review",
      }),
    ).toEqual({ text: "environment text", source: "environment" });

    expect(
      resolveAgentRoleInstruction({ settings: settings(), projectId, role: "review" }),
    ).toEqual({
      text: AGENT_ROLE_INSTRUCTION_DEFAULTS.review,
      source: "built_in",
    });
  });

  it("treats an explicit empty string as a value, not as inheritance", () => {
    expect(
      resolveAgentRoleInstruction({
        settings: settings({
          agentRoleInstructions: { review: "" },
          projectSettingsOverrides: {
            [projectId]: { agentRoleInstructions: { review: "" } },
          },
        }),
        projectId,
        role: "review",
      }),
    ).toEqual({ text: "", source: "project" });

    expect(
      resolveAgentRoleInstruction({
        settings: settings({ agentRoleInstructions: { review: "" } }),
        projectId,
        role: "review",
      }),
    ).toEqual({ text: "", source: "environment" });
  });

  it("inherits security from the environment and lets a project reset independently", () => {
    const environmentText = "Environment security text.";
    const inherited = resolveAgentRoleInstruction({
      settings: settings({
        agentRoleInstructions: { review: "Review text.", security: environmentText },
      }),
      projectId,
      role: "security",
    });
    expect(inherited).toEqual({ text: environmentText, source: "environment" });

    const project = resolveAgentRoleInstruction({
      settings: settings({
        agentRoleInstructions: { review: "Review text.", security: environmentText },
        projectSettingsOverrides: {
          [projectId]: { agentRoleInstructions: { security: "Project security text." } },
        },
      }),
      projectId,
      role: "security",
    });
    expect(project).toEqual({ text: "Project security text.", source: "project" });

    const reset = resolveAgentRoleInstruction({
      settings: settings({
        agentRoleInstructions: { review: "Review text.", security: environmentText },
        projectSettingsOverrides: {
          [projectId]: { agentRoleInstructions: { review: "Project review." } },
        },
      }),
      projectId,
      role: "security",
    });
    expect(reset).toEqual({ text: environmentText, source: "environment" });
    expect(
      resolveAgentRoleInstruction({
        settings: settings({
          agentRoleInstructions: { security: environmentText },
          projectSettingsOverrides: {
            [projectId]: { agentRoleInstructions: { security: "" } },
          },
        }),
        projectId,
        role: "security",
      }),
    ).toEqual({ text: "", source: "project" });
  });

  it("keeps instruction selection independent of role model selection", () => {
    const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };
    const resolved = resolveAgentRoleInstruction({
      settings: settings({ agentRoleModels: { review: model }, agentRoleInstructions: {} }),
      projectId,
      role: "review",
    });
    expect(resolved.source).toBe("built_in");
  });
});

describe("formatAgentRoleCatalog", () => {
  const model = (instanceId: string, slug: string) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    model: slug,
  });

  it("stays out of an untouched project's prompt", () => {
    expect(formatAgentRoleCatalog({ settings: settings(), projectId })).toBeNull();
  });

  it("lists the effective project policy, its source, and managed routing", () => {
    const design = {
      ...model("claudeAgent", "claude-sonnet-5-5"),
      options: [{ id: "effort", value: "xhigh" }],
    };
    const text = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { implementation: model("codex", "gpt-6-sol") },
        projectSettingsOverrides: {
          [projectId]: {
            agentRoleModels: { design },
            agentRoleInstructions: { design: "Hold the visual bar." },
          },
        },
      }),
      projectId,
    });

    expect(text).toContain("## Role delegation");
    expect(text).toContain("`delegate_task` with `role`");
    expect(text).toContain("a native subagent cannot");
    expect(text).toContain(
      "`design`: UI, interaction, visual, motion, and design-quality work or audits.",
    );
    expect(text).toContain(
      "claudeAgent/claude-sonnet-5-5, options effort=xhigh (project override)",
    );
    expect(text).toContain("custom role instructions");
    expect(text).toContain("codex/gpt-6-sol (environment default)");
    // A configured code role stays distinct from design.
    expect(text).toContain("`review`: Code review for correctness");
    // The child's long pre-prompt is not repeated in the parent's catalog.
    expect(text).not.toContain("Treat this as a showreel");
    expect(text).not.toContain("Hold the visual bar.");
  });

  it("routes explicit security work to security without folding it into review", () => {
    const security = {
      ...model("claudeAgent", "claude-sonnet-5-5"),
      options: [{ id: "effort", value: "xhigh" }],
    };
    const text = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { security, review: model("codex", "gpt-6-sol") },
      }),
      projectId,
    });

    expect(text).toContain(
      "`security`: Security research, threat modeling, vulnerability assessment, auth and trust-boundary review, and hardening.",
    );
    expect(text).toContain(
      "claudeAgent/claude-sonnet-5-5, options effort=xhigh (environment default)",
    );
    expect(text).toContain("`review`: Code review for correctness");
  });

  it("never leaks another project's override and keeps non-delegable keys out of the catalog", () => {
    const text = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { future_role: model("codex", "not-delegable") },
        projectSettingsOverrides: {
          [ProjectId.make("project-other")]: {
            agentRoleModels: { design: model("codex", "private-model") },
          },
          [projectId]: { agentRoleModels: { general: model("claudeAgent", "general-model") } },
        },
      }),
      projectId,
    });

    expect(text).toContain("claudeAgent/general-model");
    expect(text).not.toContain("private-model");
    expect(text).not.toContain("not-delegable");
  });

  it("treats a customized instruction entry as policy and shows a disabled preamble", () => {
    const text = formatAgentRoleCatalog({
      settings: settings({ agentRoleInstructions: { review: "", design: "Environment text." } }),
      projectId,
    });
    expect(text).not.toBeNull();
    expect(text).toContain("`review`");
    expect(text).toContain("role preamble disabled");
    expect(text).toContain("`design`");
    expect(text).toContain("custom role instructions");
  });
});

describe("formatAgentRoleInstruction", () => {
  it("wraps exact text in the T3-owned scope guard", () => {
    expect(formatAgentRoleInstruction("review", "  Read the source.\n")).toBe(
      [
        "## Role: Review",
        "These instructions set your standard of work. They don't widen your task, grant permissions, or ask you to start other agents.",
        "",
        "  Read the source.\n",
      ].join("\n"),
    );
    expect(formatAgentRoleInstruction("security", "Audit the boundary.")).toContain(
      "## Role: Security",
    );
  });

  it("omits the whole block for an explicit empty string", () => {
    expect(formatAgentRoleInstruction("review", "")).toBeNull();
  });
});
