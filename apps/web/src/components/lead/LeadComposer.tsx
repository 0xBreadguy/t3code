import { CommandId } from "@t3tools/contracts";
import type { ThreadId } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { LeadReadResult } from "@t3tools/client-runtime/rpc/lead";
import { leadScopeKey, type LeadScope } from "@t3tools/client-runtime/lead/scope";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { newMessageId, randomUUID } from "../../lib/utils";
import { useLeadBackend } from "../../rpc/lead";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useLeadDraftStore } from "./leadDraftStore";
import { LeadContextBar } from "./LeadContextBar";
import { useLeadComposerContext } from "./useLeadContext";
import type { LeadPage } from "./useLeadPage";

export function LeadComposer({
  scope,
  page,
  data,
  capabilityReason,
  running,
  projectLabel,
  contextEnabled,
  onSent,
}: {
  readonly scope: LeadScope;
  readonly page: LeadPage;
  readonly data: LeadReadResult | null;
  readonly capabilityReason: string | null;
  readonly running: boolean;
  readonly projectLabel: string;
  readonly contextEnabled: boolean;
  readonly onSent: () => void;
}) {
  const backend = useLeadBackend();
  const draft = useLeadDraftStore((state) =>
    scope === null ? null : state.draftsByScope[leadScopeKey(scope)],
  );
  const setText = useLeadDraftStore((state) => state.setText);
  const clearOnSend = useLeadDraftStore((state) => state.clearOnSend);
  const canOperate = useEnvironmentScope(scope.environmentId, AuthOrchestrationOperateScope);
  const { records, unreadable } = useLeadComposerContext(scope, page);
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = draft?.text ?? "";
  const disabledReason =
    capabilityReason ??
    (canOperate ? null : "You don't have permission to message this environment.");
  const canSend =
    disabledReason === null &&
    text.trim().length > 0 &&
    (!contextEnabled || unreadable.length === 0) &&
    !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const failure = await backend
      .send(scope.environmentId, {
        projectId: scope.projectId,
        commandId: CommandId.make(randomUUID()),
        messageId: newMessageId(),
        text: text.trim(),
        ...(contextEnabled && records.length > 0
          ? { context: { version: 1 as const, records } }
          : {}),
      })
      .then(() => null)
      .catch((sendError: unknown) =>
        sendError instanceof Error ? sendError : new Error("Couldn't send to the lead."),
      );
    if (failure === null) {
      clearOnSend(scope);
      onSent();
    } else {
      setError(failure.message);
    }
    setSending(false);
  };

  const stop = async () => {
    const threadId: ThreadId | undefined = data?.thread?.threadId;
    if (threadId === undefined) return;
    setStopping(true);
    setError(null);
    const result = await interruptTurn({
      environmentId: scope.environmentId,
      input: { threadId },
    });
    if (result._tag === "Failure") setError("Couldn't stop the lead's reply.");
    else onSent();
    setStopping(false);
  };

  return (
    <div className="border-t border-border/70 px-3 py-2.5" data-lead-composer="">
      {contextEnabled ? <LeadContextBar scope={scope} page={page} /> : null}
      {contextEnabled ? null : (
        <p className="text-3xs text-muted-foreground">
          Context attachments need a newer server; this message includes only text.
        </p>
      )}{" "}
      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(scope, event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
          rows={2}
          aria-label={`Message the ${projectLabel} lead`}
          placeholder={disabledReason ?? "Ask about the work here, or hand something over."}
        />
        {running ? (
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Stop the lead's reply"
            title="Stop the lead's reply"
            disabled={stopping}
            onClick={() => void stop()}
          >
            <SquareIcon />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            aria-label="Send to the lead"
            title="Send to the lead"
            disabled={!canSend}
            onClick={() => void send()}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
      {contextEnabled && unreadable.length > 0 ? (
        <p className="mt-1.5 text-2xs text-destructive-foreground">
          Remove the context from another machine before sending.
        </p>
      ) : null}
      {disabledReason !== null ? (
        <p className="mt-1.5 text-2xs text-muted-foreground">{disabledReason}</p>
      ) : null}
      {error !== null ? (
        <p className="mt-1.5 text-2xs text-destructive-foreground">{error}</p>
      ) : null}
      <p className="mt-1.5 text-3xs text-muted-foreground/70">Esc closes. Your draft stays.</p>
    </div>
  );
}
