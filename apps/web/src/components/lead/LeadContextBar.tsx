import type { LeadPageContext } from "@t3tools/client-runtime/lead/context";
import { leadContextKey } from "@t3tools/client-runtime/lead/context";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { ComposerContextRecord } from "@t3tools/contracts";
import { FileTextIcon, MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";

import { ThreadContextChip } from "../ThreadContextChip";
import { ContextChip, ContextChipAction, ContextChipLabel } from "../ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useLeadDraftStore } from "./leadDraftStore";
import { useLeadComposerContext } from "./useLeadContext";

function chipIcon(record: ComposerContextRecord) {
  return record.kind === "thread" ? MessageSquareIcon : FileTextIcon;
}

export function LeadContextBar({
  scope,
  page,
}: {
  readonly scope: LeadScope | null;
  readonly page: LeadPageContext | null;
}) {
  const { auto, records, unreadable, dismissedAuto } = useLeadComposerContext(scope, page);
  const removeContext = useLeadDraftStore((state) => state.removeContext);
  const dismissAutoContext = useLeadDraftStore((state) => state.dismissAutoContext);
  const reattachAutoContext = useLeadDraftStore((state) => state.reattachAutoContext);
  const autoKeys = new Set(auto.map(leadContextKey));
  const unreadableKeys = new Set(unreadable.map(leadContextKey));

  if (scope === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-lead-context-bar="">
      {records.map((record) => {
        const key = leadContextKey(record);
        const isAuto = autoKeys.has(key);
        const isUnreadable = unreadableKeys.has(key);
        const remove = () => {
          if (isAuto) dismissAutoContext(scope, key);
          else removeContext(scope, key);
        };
        if (record.kind === "thread" && "environmentId" in record) {
          return (
            <span key={key} className="inline-flex items-center gap-0.5">
              <ThreadContextChip
                record={record}
                unreadable={isUnreadable}
                copyMarkdown={`[${record.label}]`}
              />
              <ContextChipAction
                aria-label={`Remove context: ${record.label}`}
                title={`Remove context: ${record.label}`}
                onClick={remove}
              >
                <XIcon />
              </ContextChipAction>
            </span>
          );
        }
        const Icon = chipIcon(record);
        return (
          <Tooltip key={key}>
            <TooltipTrigger render={<span className="inline-flex items-center gap-0.5" />}>
              <ContextChip
                kind={record.kind === "review-comment" ? "review-comment" : "file"}
                {...(isUnreadable ? { state: "invalid" as const } : {})}
                tabIndex={0}
              >
                <Icon />
                <ContextChipLabel>{record.label}</ContextChipLabel>
              </ContextChip>
              <ContextChipAction
                aria-label={`Remove context: ${record.label}`}
                title={`Remove context: ${record.label}`}
                onClick={remove}
              >
                <XIcon />
              </ContextChipAction>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {isUnreadable
                ? "On another machine, so this machine's agent can't read it. Remove it or switch back to send."
                : "Attached to your next message"}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {dismissedAuto.map((record) => (
        <button
          key={leadContextKey(record)}
          type="button"
          onClick={() => reattachAutoContext(scope, leadContextKey(record))}
          aria-label={`Attach ${record.label}`}
          className="inline-flex items-center gap-1 rounded-sm text-2xs text-muted-foreground hover:text-foreground"
        >
          <PlusIcon className="size-3" />
          Attach {record.label}
        </button>
      ))}
    </div>
  );
}
