import { msg } from "gt-react";
import type { AgentRole } from "@t3tools/contracts";

export interface AgentRoleRow {
  readonly role: AgentRole;
  readonly title: string;
  readonly description: string;
}

export const AGENT_ROLE_ROWS: ReadonlyArray<AgentRoleRow> = [
  {
    role: "architecture",
    title: msg("Architecture"),
    description: msg("Plans structure, boundaries, and technical direction."),
  },
  {
    role: "implementation",
    title: msg("Implementation"),
    description: msg("Writes code for a scoped task."),
  },
  {
    role: "research",
    title: msg("Research"),
    description: msg("Investigates the codebase and outside material."),
  },
  {
    role: "review",
    title: msg("Review"),
    description: msg(
      "Reviews changes and reports findings. Selecting a review model does not run a review.",
    ),
  },
  {
    role: "security",
    title: msg("Security"),
    description: msg("Researches vulnerabilities, models threats, and recommends hardening."),
  },
  {
    role: "design",
    title: msg("Design"),
    description: msg("Works on interface, interaction, and visual design."),
  },
  { role: "test", title: msg("Test"), description: msg("Writes and runs tests.") },
  {
    role: "general",
    title: msg("General"),
    description: msg("Work that does not fit another role."),
  },
];
