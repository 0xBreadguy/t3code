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
    expect(formatAgentRoleCatalog({ settings: settings(), projectId, topLevel: true })).toBeNull();
  });

  it("stays out of a delegated child's prompt even with a configured role", () => {
    expect(
      formatAgentRoleCatalog({
        settings: settings({
          agentRoleModels: { implementation: model("codex", "gpt-6-sol") },
        }),
        projectId,
        topLevel: false,
      }),
    ).toBeNull();
  });

  it("does not activate a role from instructions or a delegation mode alone", () => {
    expect(
      formatAgentRoleCatalog({
        settings: settings({
          agentRoleInstructions: { review: "", design: "Environment text." },
          agentRoleDelegationModes: { review: "always", design: "always" },
        }),
        projectId,
        topLevel: true,
      }),
    ).toBeNull();
  });

  it("checks only configured roles before choosing direct work", () => {
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
      topLevel: true,
    });

    expect(text).toContain("## Role delegation");
    expect(text).toContain("check the configured roles below");
    expect(text).toContain("then apply each role's mode");
    expect(text).toContain("a `prefer` role leaves small, direct work to your judgment");
    expect(text).not.toContain("when the work matches a role, call `delegate_task`");
    expect(text).toContain("a native subagent cannot");
    expect(text).toContain(
      "`design`: UI, interaction, visual, motion, and design-quality work or audits.",
    );
    expect(text).toContain(
      "claudeAgent/claude-sonnet-5-5, options effort=xhigh (project override)",
    );
    expect(text).toContain("custom role instructions");
    expect(text).toContain("codex/gpt-6-sol (environment default)");
    // An unconfigured role stays inactive, so the model cannot route to it here.
    expect(text).not.toContain("`review`");
    // The child's long pre-prompt is not repeated in the parent's catalog.
    expect(text).not.toContain("Treat this as a showreel");
    expect(text).not.toContain("Hold the visual bar.");
  });

  it("defaults to prefer and honors an always role", () => {
    const text = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { implementation: model("codex", "gpt-6-sol") },
        agentRoleDelegationModes: { implementation: "always" },
      }),
      projectId,
      topLevel: true,
    });
    expect(text).toContain(
      "Always delegate actual work that matches this role, even when you could do it yourself.",
    );
    expect(text).toContain("an `always` role takes actual matching work");
    expect(text).not.toContain("Prefer delegation for substantive, scoped work");
  });

  it("inherits the environment mode and lets a project entry override it", () => {
    const prefer = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { review: model("codex", "gpt-6-sol") },
        agentRoleDelegationModes: { review: "always" },
        projectSettingsOverrides: {
          [projectId]: { agentRoleDelegationModes: { review: "prefer" } },
        },
      }),
      projectId,
      topLevel: true,
    });
    expect(prefer).toContain("Prefer delegation for substantive, scoped work");

    const inherited = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { review: model("codex", "gpt-6-sol") },
        agentRoleDelegationModes: { review: "always" },
      }),
      projectId,
      topLevel: true,
    });
    expect(inherited).toContain(
      "Always delegate actual work that matches this role, even when you could do it yourself.",
    );
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
      topLevel: true,
    });

    expect(text).toContain(
      "`security`: Security research, threat modeling, vulnerability assessment, auth and trust-boundary review, and hardening.",
    );
    expect(text).toContain(
      "An actual requested security audit or review matches `security`; a mere mention of security, or a simple explanatory question, does not.",
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
      topLevel: true,
    });

    expect(text).toContain("claudeAgent/general-model");
    expect(text).not.toContain("private-model");
    expect(text).not.toContain("not-delegable");
  });

  it("shows a customized instruction entry on a configured role, including a disabled preamble", () => {
    const text = formatAgentRoleCatalog({
      settings: settings({
        agentRoleModels: { review: model("codex", "gpt-6-sol") },
        agentRoleInstructions: { review: "" },
      }),
      projectId,
      topLevel: true,
    });
    expect(text).toContain("`review`");
    expect(text).toContain("role preamble disabled");
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
