import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type {
  LeadHandoff,
  LeadOwnershipAction,
  LeadReadResult,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { CommandId, MessageId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { uuidv4 } from "../../lib/uuid";
import { useThreadShell } from "../../state/entities";
import { leadEnvironment, leadErrorMessage, unwrapLeadResult } from "../../state/lead";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  LEAD_OWNERSHIP_ACTION_LABELS,
  LEAD_RECONCILE_TEXT,
  LEAD_REVIEW_PENDING_TEXT,
  formatReportedChecks,
  handoffHeadLabel,
  isActiveGrant,
  ownershipSummary,
} from "./leadPresentation";

const OWNERSHIP_ACTIONS: ReadonlyArray<LeadOwnershipAction> = ["reconcile", "open_pr", "merge"];

function LeadHandoffReport(props: {
  readonly scope: LeadScope;
  readonly handoff: LeadHandoff;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const threadRef = {
    environmentId: props.scope.environmentId,
    threadId: props.handoff.sourceThreadId,
  };
  const shell = useThreadShell(threadRef);
  const checks = formatReportedChecks(props.handoff.checks);
  const body = (
    <View className="gap-1 rounded-2xl border border-border bg-card-alt px-3 py-2.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text numberOfLines={1} className="min-w-0 shrink font-t3-medium text-sm text-foreground">
          {shell?.title.trim() || "Worker report"}
        </Text>
        <Text className="shrink-0 text-2xs text-foreground-muted">Review required</Text>
      </View>
      <Text numberOfLines={3} className="text-xs text-foreground-secondary">
        {props.handoff.summary}
      </Text>
      <Text className="text-2xs text-foreground-muted">
        {checks === null ? "No checks reported." : `Worker reports: ${checks}`}
      </Text>
      <Text className="text-2xs text-foreground-muted">
        {`${handoffHeadLabel(props.handoff)} · not merged · review required`}
      </Text>
    </View>
  );
  return shell === null ? (
    body
  ) : (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Opens this worker's thread"
      onPress={() => props.onOpenThread(threadRef)}
      className="active:opacity-70"
    >
      {body}
    </Pressable>
  );
}

/**
 * Durable handoff and ownership records. A grant needs this explicit user
 * action; worker or lead text never mints one.
 */
export function LeadWork(props: {
  readonly scope: LeadScope;
  readonly data: LeadReadResult | null;
  readonly capabilityReason: string | null;
  readonly canSend: boolean;
  readonly canWriteSettings: boolean;
  readonly projectLabel: string;
  readonly onChanged: () => void;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const sendCommand = useAtomCommand(leadEnvironment.send, { reportFailure: false });
  const grantCommand = useAtomCommand(leadEnvironment.grant, { reportFailure: false });
  const revokeCommand = useAtomCommand(leadEnvironment.revoke, { reportFailure: false });
  const [grantOpen, setGrantOpen] = useState(false);
  const [actions, setActions] = useState<ReadonlyArray<LeadOwnershipAction>>(["reconcile"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = props.data;
  if (data === null || data.binding === null) return null;

  const pendingHandoffs = data.pendingHandoffCount;
  const ownership = data.state?.ownership ?? null;
  const activeGrant = isActiveGrant(ownership) ? ownership : null;
  const revision = data.state?.revision ?? 0;
  const unavailable = props.capabilityReason;
  const disabled = unavailable !== null || busy;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      props.onChanged();
    } catch (actionError) {
      setError(leadErrorMessage(actionError, "That didn't work. Try again."));
    }
    setBusy(false);
  };

  const sendText = (text: string) =>
    run(async () => {
      unwrapLeadResult(
        await sendCommand({
          environmentId: props.scope.environmentId,
          input: {
            projectId: props.scope.projectId,
            commandId: CommandId.make(uuidv4()),
            messageId: MessageId.make(uuidv4()),
            text,
          },
        }),
      );
    });

  const grant = () =>
    run(async () => {
      if (actions.length === 0) return;
      unwrapLeadResult(
        await grantCommand({
          environmentId: props.scope.environmentId,
          input: {
            projectId: props.scope.projectId,
            expectedRevision: revision,
            scope: { type: "project" },
            actions,
          },
        }),
      );
      setGrantOpen(false);
    });

  const takeBack = () =>
    run(async () => {
      if (activeGrant === null) return;
      unwrapLeadResult(
        await revokeCommand({
          environmentId: props.scope.environmentId,
          input: {
            projectId: props.scope.projectId,
            expectedRevision: revision,
            grantId: activeGrant.id,
          },
        }),
      );
    });

  return (
    <View className="gap-2.5">
      {pendingHandoffs > 0 ? (
        <View className="gap-2 rounded-2xl border border-border bg-card-alt px-3 py-2.5">
          <Text className="text-sm text-foreground-secondary">
            {pendingHandoffs === 1
              ? "1 worker handed work back"
              : `${pendingHandoffs} workers handed work back`}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Review pending work"
              tone="secondary"
              disabled={disabled || !props.canSend}
              onPress={() => void sendText(LEAD_REVIEW_PENDING_TEXT)}
            />
            <Button
              label="Reconcile as recommended"
              disabled={disabled || !props.canSend}
              onPress={() => void sendText(LEAD_RECONCILE_TEXT)}
            />
          </View>
          <Text className="text-2xs text-foreground-muted">
            Reconcile combines on a separate branch and runs checks. It won't open a PR.
          </Text>
        </View>
      ) : null}

      {data.state?.handoffs.slice(-3).map((handoff) => (
        <LeadHandoffReport
          key={handoff.id}
          scope={props.scope}
          handoff={handoff}
          onOpenThread={props.onOpenThread}
        />
      ))}

      {activeGrant !== null ? (
        <View className="gap-2 rounded-2xl border border-border bg-card-alt px-3 py-2.5">
          <Text className="text-sm text-foreground">{ownershipSummary(activeGrant)}</Text>
          <Text className="text-2xs text-foreground-muted">
            It won't change what providers may run without asking. Those permissions stay as they
            are. Ends when you take it back.
          </Text>
          <Button
            label="Take back"
            tone="text"
            disabled={disabled || !props.canWriteSettings}
            onPress={() => void takeBack()}
          />
        </View>
      ) : grantOpen ? (
        <View className="gap-2.5 rounded-2xl border border-border bg-card-alt px-3 py-2.5">
          <Text className="text-sm text-foreground">
            {`The ${props.projectLabel} lead will own this project.`}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {OWNERSHIP_ACTIONS.map((action) => (
              <Chip
                key={action}
                size="small"
                label={LEAD_OWNERSHIP_ACTION_LABELS[action]}
                selected={actions.includes(action)}
                onPress={() =>
                  setActions((current) =>
                    current.includes(action)
                      ? current.filter((entry) => entry !== action)
                      : [...current, action],
                  )
                }
                accessibilityLabel={`Allow the lead to ${LEAD_OWNERSHIP_ACTION_LABELS[action]}`}
              />
            ))}
          </View>
          <Text className="text-2xs text-foreground-muted">
            It won't change what providers may run without asking. A grant doesn't sandbox shell
            commands or undo earlier work. Ends when you take it back.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Hand over"
              disabled={disabled || !props.canWriteSettings || busy || actions.length === 0}
              onPress={() => void grant()}
            />
            <Button label="Back" tone="text" onPress={() => setGrantOpen(false)} />
          </View>
        </View>
      ) : (
        <View className="gap-1">
          <Button
            label="Hand over authority…"
            tone="text"
            disabled={disabled || !props.canWriteSettings}
            onPress={() => setGrantOpen(true)}
          />
          {!props.canWriteSettings && unavailable === null ? (
            <Text className="text-2xs text-foreground-muted">
              You don't have permission to change settings on this environment.
            </Text>
          ) : null}
        </View>
      )}

      {error !== null ? (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
