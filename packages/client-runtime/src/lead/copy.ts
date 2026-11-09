import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export type LeadModelSource =
  | { readonly kind: "conversation-override" }
  | { readonly kind: "project-role"; readonly role: string }
  | { readonly kind: "environment-role"; readonly role: string }
  | { readonly kind: "project-default" }
  | { readonly kind: "inherited" };

/** “Runs as …”, with the source that actually picked the model. */
export function formatLeadRoleResolution(input: {
  readonly modelLabel: string;
  readonly source: LeadModelSource;
  readonly roleModelLabel?: string;
}): string {
  switch (input.source.kind) {
    case "conversation-override":
      return input.roleModelLabel === undefined
        ? `Runs as ${input.modelLabel} · chosen for this conversation`
        : `Runs as ${input.modelLabel} · chosen for this conversation (Lead role: ${input.roleModelLabel})`;
    case "project-role":
      return `Runs as ${input.modelLabel} (project ${input.source.role} role)`;
    case "environment-role":
      return `Runs as ${input.modelLabel} (${input.source.role} role)`;
    case "project-default":
      return `Runs as ${input.modelLabel} (project default)`;
    case "inherited":
      return `Runs as ${input.modelLabel}`;
  }
}

function parseDate(value: string | Date): Date | null {
  if (value instanceof Date) return value;
  return Option.match(DateTime.make(value), {
    onNone: () => null,
    onSome: (dateTime) => DateTime.toDate(dateTime),
  });
}

/** A time for an observation, and a date once it is no longer today. */
export function formatLeadObservedAt(
  isoTimestamp: string,
  options: { readonly now?: Date; readonly locale?: string | undefined } = {},
): string {
  const date = parseDate(isoTimestamp);
  if (date === null) return "Observed";
  const now = options.now ?? DateTime.toDate(DateTime.nowUnsafe());
  const locale = options.locale;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (sameDay) return `Observed ${time}`;
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
  return `Observed ${day}, ${time}`;
}
