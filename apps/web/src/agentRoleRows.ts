import type { AgentRole } from "@t3tools/contracts";

export interface AgentRoleRow {
  readonly role: AgentRole;
  readonly title: string;
  readonly description: string;
}

export const AGENT_ROLE_ROWS: ReadonlyArray<AgentRoleRow> = [
  {
    role: "lead",
    title: "Lead",
    description:
      "Watches work handed back, recommends what to combine, and acts on your request or a recorded ownership grant.",
  },
  {
    role: "architecture",
    title: "Architecture",
    description: "Plans structure, boundaries, and technical direction.",
  },
  {
    role: "implementation",
    title: "Implementation",
    description: "Writes code for a scoped task.",
  },
  {
    role: "research",
    title: "Research",
    description: "Investigates the codebase and outside material.",
  },
  {
    role: "review",
    title: "Review",
    description:
      "Reviews changes and reports findings. Selecting a review model does not run a review.",
  },
  {
    role: "design",
    title: "Design",
    description: "Works on interface, interaction, and visual design.",
  },
  { role: "test", title: "Test", description: "Writes and runs tests." },
  {
    role: "general",
    title: "General",
    description: "Work that does not fit another role.",
  },
];
