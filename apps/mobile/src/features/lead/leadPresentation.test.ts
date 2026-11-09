import type { LeadCapability } from "@t3tools/client-runtime/rpc/lead";
import type { LeadOwnershipGrant, LeadReportedCheck, LeadThreadSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LEAD_ROLE_UNSET_COPY,
  deriveLeadSheetStatus,
  formatReportedChecks,
  leadComposerAvailability,
  leadModelSummary,
  leadRoleRows,
  ownershipSummary,
} from "./leadPresentation";

const supported: LeadCapability = { kind: "supported", contextRefs: true };
const unsupported: LeadCapability = {
  kind: "unsupported",
  reason: "This server needs an update to use the lead.",
};

const thread: LeadThreadSummary = {
  threadId: "lead-thread" as LeadThreadSummary["threadId"],
  projectId: "project" as LeadThreadSummary["projectId"],
  title: "Project lead",
  providerInstanceId: "claude" as LeadThreadSummary["providerInstanceId"],
  model: "claude-opus-5-5",
  archived: false,
  active: false,
  updatedAt: "2026-11-08T12:00:00.000Z",
};

const grant: LeadOwnershipGrant = {
  id: "grant-1",
  scope: { type: "project" },
  actions: ["reconcile", "merge"],
  grantedAt: "2026-11-08T12:00:00.000Z",
  revokedAt: null,
};

describe("lead sheet status", () => {
  const base = {
    capability: supported,
    online: true,
    running: false,
    ownership: null,
    reportsToReview: 0,
  };

  it("reports the first applicable state", () => {
    expect(deriveLeadSheetStatus(base).kind).toBe("observing");
    expect(deriveLeadSheetStatus({ ...base, reportsToReview: 2 }).kind).toBe("reports");
    expect(deriveLeadSheetStatus({ ...base, reportsToReview: 2, ownership: grant }).kind).toBe(
      "owns-project",
    );
    expect(deriveLeadSheetStatus({ ...base, running: true }).kind).toBe("writing");
    expect(deriveLeadSheetStatus({ ...base, online: false }).kind).toBe("offline");
    expect(deriveLeadSheetStatus({ ...base, capability: unsupported, online: false }).kind).toBe(
      "needs-update",
    );
  });

  it("treats a revoked grant as no ownership", () => {
    const revoked = { ...grant, revokedAt: "2026-11-08T13:00:00.000Z" };
    expect(deriveLeadSheetStatus({ ...base, ownership: revoked }).kind).toBe("observing");
  });
});

describe("lead composer availability", () => {
  const base = {
    capability: supported,
    online: true,
    environmentLabel: "studio-mac",
    canOperate: true,
    text: "What should I combine?",
    unreadableContextCount: 0,
    sending: false,
  };

  it("sends a non-empty message when the environment is available", () => {
    expect(leadComposerAvailability(base)).toEqual({ canSend: true, reason: null });
  });

  it("disables without a reason for an empty draft", () => {
    expect(leadComposerAvailability({ ...base, text: "   " })).toEqual({
      canSend: false,
      reason: null,
    });
  });

  it("explains an offline environment and keeps the draft editable", () => {
    const availability = leadComposerAvailability({
      ...base,
      capability: { kind: "offline", since: null },
      online: false,
    });
    expect(availability.canSend).toBe(false);
    expect(availability.reason).toContain("studio-mac");
  });

  it("prefers the server update reason over offline state", () => {
    const availability = leadComposerAvailability({
      ...base,
      capability: unsupported,
      online: false,
    });
    expect(availability.reason).toBe(unsupported.reason);
  });

  it("blocks unreadable context and missing permission with distinct reasons", () => {
    expect(leadComposerAvailability({ ...base, unreadableContextCount: 1 }).reason).toContain(
      "another machine",
    );
    expect(leadComposerAvailability({ ...base, canOperate: false }).reason).toContain("permission");
  });
});

describe("lead model and report presentation", () => {
  it("shows the bound thread's model and provider", () => {
    expect(leadModelSummary({ thread, roleModel: undefined })).toBe(
      "Runs as Claude Opus 5.5 · claude",
    );
  });

  it("shows the configured role model before a lead thread exists", () => {
    expect(
      leadModelSummary({
        thread: null,
        roleModel: { instanceId: "claude" as never, model: "claude-opus-5-5" },
      }),
    ).toBe("Lead role · Claude Opus 5.5");
  });

  it("points at web/desktop roles when no lead model is set", () => {
    expect(leadModelSummary({ thread: null, roleModel: undefined })).toBe(LEAD_ROLE_UNSET_COPY);
  });

  it("lists only configured roles in a stable order", () => {
    expect(
      leadRoleRows({
        implementation: { instanceId: "codex" as never, model: "gpt-5" },
        lead: { instanceId: "claude" as never, model: "claude-opus-5-5" },
      }),
    ).toEqual([
      { role: "lead", model: "Claude Opus 5.5" },
      { role: "implementation", model: "GPT-5" },
    ]);
  });

  it("renders reported checks as plain text and names ownership terms", () => {
    const checks: ReadonlyArray<LeadReportedCheck> = [
      { name: "typecheck", outcome: "passed" },
      { name: "unit tests", outcome: "failed" },
    ];
    expect(formatReportedChecks(checks)).toBe("typecheck passed · unit tests failed");
    expect(formatReportedChecks([])).toBeNull();
    expect(ownershipSummary(grant)).toContain("may combine and check work, merge");
  });
});
