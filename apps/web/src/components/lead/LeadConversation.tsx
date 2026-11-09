import type { ScopedThreadRef } from "@t3tools/contracts";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useAssistantMessageText, useTimelineVisibleTurnItems } from "../../state/entities";
import ChatMarkdown from "../ChatMarkdown";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { ThreadContextChip } from "../ThreadContextChip";
import { leadContextKey } from "@t3tools/client-runtime/lead/context";
import type { ComposerContextRecord } from "@t3tools/contracts";

function contextChipKind(record: ComposerContextRecord) {
  switch (record.kind) {
    case "image":
    case "file":
    case "terminal":
    case "element":
    case "preview-annotation":
    case "review-comment":
    case "mention":
    case "skill":
    case "thread":
    case "environment":
      return record.kind;
    default:
      return "neutral" as const;
  }
}

function LeadMessageContext({
  records,
}: {
  readonly records: ReadonlyArray<ComposerContextRecord>;
}) {
  if (records.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {records.map((record) => {
        if (record.kind === "thread" && "environmentId" in record) {
          return (
            <ThreadContextChip
              key={leadContextKey(record)}
              record={record}
              copyMarkdown={`[${record.label}]`}
            />
          );
        }
        return (
          <ContextChip key={leadContextKey(record)} kind={contextChipKind(record)} tabIndex={0}>
            <ContextChipLabel>{record.label}</ContextChipLabel>
          </ContextChip>
        );
      })}
    </div>
  );
}

function useLeadAssistantText(
  ref: ScopedThreadRef,
  item: Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "assistant_message" }>,
): string {
  return useAssistantMessageText(ref, item.messageId) ?? item.text;
}

function LeadAssistantRow({
  ref,
  item,
}: {
  readonly ref: ScopedThreadRef;
  readonly item: Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "assistant_message" }>;
}) {
  const text = useLeadAssistantText(ref, item);
  if (text.trim().length === 0 && !item.streaming) return null;
  return (
    <div className="max-w-none text-sm leading-relaxed text-foreground">
      <ChatMarkdown text={text} cwd={undefined} />
      {item.streaming ? (
        <span className="ms-1 text-muted-foreground" aria-live="polite">
          Writing…
        </span>
      ) : null}
    </div>
  );
}

function LeadUserRow({
  item,
}: {
  readonly item: Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "user_message" }>;
}) {
  return (
    <div className="ms-auto max-w-[85%] rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
      <div className="whitespace-pre-wrap wrap-break-word">{item.text}</div>
      {item.context !== undefined ? <LeadMessageContext records={item.context.records} /> : null}
    </div>
  );
}

function LeadWorkRow({
  item,
}: {
  readonly item:
    | Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "command_execution" }>
    | Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "file_change" }>;
}) {
  const label =
    item.type === "command_execution"
      ? `Ran ${item.input.split("\n")[0]?.slice(0, 120) ?? "a command"}`
      : `Changed ${item.fileName}`;
  return <div className="truncate text-2xs text-muted-foreground">{label}</div>;
}

export function LeadConversation({
  threadRef,
  emptyCopy,
  className,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly emptyCopy: string;
  readonly className?: string;
}) {
  const items = useTimelineVisibleTurnItems(threadRef);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the newest lead message in view as the turn streams
  useEffect(() => {
    if (items.length === 0) return;
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [items]);

  if (threadRef === null) {
    return (
      <div className={className}>
        <p className="px-1 py-3 text-sm text-muted-foreground">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={className} data-lead-conversation="">
      {items.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">{emptyCopy}</p>
      ) : (
        <div className="flex flex-col gap-3 pb-3">
          {items.map((projected) => {
            const item = projected.item;
            switch (item.type) {
              case "user_message":
                return <LeadUserRow key={projected.sourceItemId} item={item} />;
              case "assistant_message":
                return (
                  <LeadAssistantRow key={projected.sourceItemId} ref={threadRef} item={item} />
                );
              case "command_execution":
              case "file_change":
                return <LeadWorkRow key={projected.sourceItemId} item={item} />;
              default:
                return null;
            }
          })}
        </div>
      )}
    </div>
  );
}
