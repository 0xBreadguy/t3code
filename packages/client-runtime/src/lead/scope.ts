import { EnvironmentId, ProjectId } from "@t3tools/contracts";

/** A lead conversation belongs to one project in one environment. */
export interface LeadScope {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export function leadScopeKey(scope: LeadScope): string {
  return `${scope.environmentId}\u0000${scope.projectId}`;
}

export function parseLeadScopeKey(key: string): LeadScope | null {
  const separator = key.indexOf("\u0000");
  if (separator < 0) return null;
  return {
    environmentId: EnvironmentId.make(key.slice(0, separator)),
    projectId: ProjectId.make(key.slice(separator + 1)),
  };
}

export function sameLeadScope(
  left: LeadScope | null | undefined,
  right: LeadScope | null | undefined,
): boolean {
  return (
    left != null &&
    right != null &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId
  );
}

/** Why the open lead is not looking at the page's project. */
export type LeadContinuity =
  | { readonly kind: "none" }
  | { readonly kind: "other-project"; readonly page: LeadScope }
  | { readonly kind: "other-environment"; readonly page: LeadScope }
  | { readonly kind: "no-project" };

export type LeadScopeSource = "explicit" | "retained" | "page" | "none";

export interface ResolvedLeadOpenScope {
  readonly scope: LeadScope | null;
  readonly continuity: LeadContinuity;
  readonly source: LeadScopeSource;
}

function leadContinuity(scope: LeadScope | null, page: LeadScope | null): LeadContinuity {
  if (scope === null) return { kind: "none" };
  if (page === null) return { kind: "no-project" };
  if (scope.environmentId !== page.environmentId) {
    return { kind: "other-environment", page };
  }
  if (scope.projectId !== page.projectId) {
    return { kind: "other-project", page };
  }
  return { kind: "none" };
}

/**
 * Precedence is explicit target > retained scope > page project. A page never
 * retargets an open lead, and a retained scope never follows navigation.
 */
export function resolveLeadOpenScope(input: {
  readonly retained: LeadScope | null;
  readonly page: LeadScope | null;
  readonly explicit?: LeadScope | null;
}): ResolvedLeadOpenScope {
  const scope = input.explicit ?? input.retained ?? input.page;
  const source: LeadScopeSource =
    input.explicit != null
      ? "explicit"
      : input.retained != null
        ? "retained"
        : input.page != null
          ? "page"
          : "none";
  return {
    scope,
    continuity: leadContinuity(scope, input.page),
    source,
  };
}
