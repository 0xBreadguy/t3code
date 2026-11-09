import type { LeadPageContext } from "@t3tools/client-runtime/lead/context";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { CommandId, MessageId } from "@t3tools/contracts";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { uuidv4 } from "../../lib/uuid";
import { leadEnvironment, leadErrorMessage, unwrapLeadResult } from "../../state/lead";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { LeadContextChips } from "./LeadContextChips";
import { clearLeadDraftAfterSend, setLeadDraftText } from "./leadDraftModel";
import { updateLeadDrafts, useLeadDraft } from "./leadDrafts";
import { leadComposerAvailability } from "./leadPresentation";
import { useLeadComposerContext } from "./useLeadContext";
import type { LeadSessionState } from "./useLeadSession";

export function LeadComposer(props: {
  readonly scope: LeadScope;
  readonly page: LeadPageContext | null;
  readonly projectLabel: string;
  readonly session: LeadSessionState;
  readonly threadRef: ScopedThreadRef | null;
  readonly running: boolean;
  readonly onSent: (threadId: ThreadId) => void;
}) {
  const { scope, session } = props;
  const draft = useLeadDraft(scope);
  const { records, unreadable } = useLeadComposerContext(scope, props.page);
  const canOperate = useAtomValue(leadEnvironment.send.permissionAtom(scope.environmentId));
  const sendCommand = useAtomCommand(leadEnvironment.send, { reportFailure: false });
  const interruptCommand = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = draft?.text ?? "";
  const contextEnabled = session.capability.kind === "supported" && session.capability.contextRefs;
  const availability = leadComposerAvailability({
    capability: session.capability,
    online: session.online,
    environmentLabel: session.label,
    canOperate,
    text,
    unreadableContextCount: contextEnabled ? unreadable.length : 0,
    sending,
  });

  const send = async () => {
    if (!availability.canSend) return;
    setSending(true);
    setError(null);
    const context = contextEnabled && records.length > 0 ? { version: 1 as const, records } : null;
    const input = {
      projectId: scope.projectId,
      commandId: CommandId.make(uuidv4()),
      messageId: MessageId.make(uuidv4()),
      text: text.trim(),
      ...(context === null ? {} : { context }),
    };
    try {
      const result = unwrapLeadResult(
        await sendCommand({ environmentId: scope.environmentId, input }),
      );
      updateLeadDrafts((drafts) => clearLeadDraftAfterSend(drafts, scope));
      props.onSent(result.threadId);
    } catch (sendError) {
      setError(leadErrorMessage(sendError, "Couldn't send. Try again."));
    }
    setSending(false);
  };

  const stop = async () => {
    const threadRef = props.threadRef;
    if (threadRef === null) return;
    setStopping(true);
    setError(null);
    const result = await interruptCommand({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Failure") {
      setError("Couldn't stop the lead's reply. Try again.");
    } else {
      props.onSent(threadRef.threadId);
    }
    setStopping(false);
  };

  return (
    <View className="gap-2 border-t border-border bg-sheet px-4 pb-2 pt-2.5">
      {contextEnabled ? <LeadContextChips scope={scope} page={props.page} /> : null}
      <View className="flex-row items-end gap-2">
        <TextInput
          value={text}
          onChangeText={(next) =>
            updateLeadDrafts((drafts) => setLeadDraftText(drafts, scope, next))
          }
          multiline
          accessibilityLabel={`Message the ${props.projectLabel} lead`}
          placeholder={`Message the ${props.projectLabel} lead`}
          className="max-h-32 min-h-[44px] flex-1 py-2.5"
        />
        {props.running ? (
          <ControlPill
            accessibilityLabel="Stop the lead's reply"
            icon="stop.fill"
            variant="danger"
            disabled={stopping || !canOperate}
            onPress={() => void stop()}
          />
        ) : (
          <ControlPill
            accessibilityLabel={`Send to the ${props.projectLabel} lead`}
            icon="arrow.up"
            variant="primary"
            disabled={!availability.canSend}
            onPress={() => void send()}
          />
        )}
      </View>
      {availability.reason !== null ? (
        <Text className="text-xs text-foreground-muted">{availability.reason}</Text>
      ) : null}
      {error !== null ? (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {error}
        </Text>
      ) : null}
      <Text className="text-2xs text-foreground-muted">
        Your draft stays here when you close the lead.
      </Text>
    </View>
  );
}
