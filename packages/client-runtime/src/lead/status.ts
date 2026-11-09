import type { LeadScope } from "./scope.ts";

export interface LeadScopeStatus {
  readonly scope: LeadScope;
  readonly scopeLabel: string;
  readonly environmentLabel: string;
  readonly needsYouCount: number;
  readonly decisionsCount: number;
  readonly grantActive: boolean;
  readonly unreadReply: boolean;
  readonly offline: boolean;
}

export interface LeadButtonStatus {
  readonly visible: boolean;
  readonly needsYouCount: number;
  readonly decisionsCount: number;
  readonly grantActive: boolean;
  readonly offlineEnvironments: ReadonlyArray<string>;
  readonly unreadReply: boolean;
  readonly scopeLabel: string | null;
  readonly label: string;
}

/**
 * One priority order for web and a later native sheet. The first applicable
 * state names the button; counts are display data, not invented activity.
 */
export function deriveLeadButtonStatus(input: {
  readonly connectedEnvironmentCount: number;
  readonly scopes: ReadonlyArray<LeadScopeStatus>;
}): LeadButtonStatus {
  const visible = input.connectedEnvironmentCount > 0;
  const needsYouCount = sum(input.scopes.map((scope) => scope.needsYouCount));
  const decisionsCount = sum(input.scopes.map((scope) => scope.decisionsCount));
  const grantScope = input.scopes.find((scope) => scope.grantActive) ?? null;
  const grantActive = grantScope !== null;
  const offlineEnvironments = unique(
    input.scopes.filter((scope) => scope.offline).map((scope) => scope.environmentLabel),
  );
  const unreadReply = input.scopes.some((scope) => scope.unreadReply);
  const scopeLabel = grantScope?.scopeLabel ?? null;
  return {
    visible,
    needsYouCount,
    decisionsCount,
    grantActive,
    offlineEnvironments,
    unreadReply,
    scopeLabel,
    label: leadButtonLabel({
      visible,
      needsYouCount,
      decisionsCount,
      grantActive,
      scopeLabel,
      offlineEnvironments,
      unreadReply,
    }),
  };
}

function leadButtonLabel(input: Omit<LeadButtonStatus, "label">): string {
  if (!input.visible) return "Lead";
  if (input.needsYouCount > 0) return "Lead, needs your approval";
  if (input.grantActive) {
    return input.scopeLabel === null
      ? "Lead, owns a batch"
      : `Lead, owns a batch in ${input.scopeLabel}`;
  }
  if (input.decisionsCount > 0) {
    return input.decisionsCount === 1
      ? "Lead, 1 decision waiting"
      : `Lead, ${input.decisionsCount} decisions waiting`;
  }
  if (input.offlineEnvironments.length === 1) {
    return `Lead, ${input.offlineEnvironments[0]} offline`;
  }
  if (input.offlineEnvironments.length > 1) return "Lead, some environments offline";
  if (input.unreadReply) return "Lead, new reply";
  return "Lead";
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}

function unique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)];
}
