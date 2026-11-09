import { useAtomValue } from "@effect/atom-react";
import { leadContextKey } from "@t3tools/client-runtime/lead/context";
import type {
  ComposerContextRecord,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { Atom } from "effect/reactivity";
import type React from "react";
import { useRef, type ReactNode } from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { useLiveThreadLinkLabels, resolveThreadLink } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails } from "../../state/threads";

const EMPTY_TURN_ITEMS_ATOM = Atom.make<OrchestrationV2ThreadProjection["visibleTurnItems"]>(
  Object.freeze([]),
).pipe(Atom.withLabel("mobile-lead-conversation:empty"));

/**
 * A focused view of the lead's ordinary thread: the same projection, streaming
 * and markdown building blocks the chat uses, without the full chat engine.
 */
export function LeadConversation(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly projectId: string;
  readonly emptyCopy: string;
  readonly header?: ReactNode;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const items = useAtomValue(
    props.threadRef === null
      ? EMPTY_TURN_ITEMS_ATOM
      : environmentThreadDetails.timelineVisibleTurnItemsAtom(props.threadRef),
  );
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const atEnd = useRef(true);
  const measured = useRef(false);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    atEnd.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 48;
  };

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerClassName="gap-3 px-4 py-3"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScroll={onScroll}
      scrollEventThrottle={100}
      // Follow only while the list is at its end, so reading older messages never jumps.
      // The first measurement keeps the work and roles header in view.
      onContentSizeChange={() => {
        if (!measured.current) {
          measured.current = true;
          return;
        }
        if (atEnd.current && items.length > 0) {
          scrollRef.current?.scrollToEnd({ animated: false });
        }
      }}
    >
      {props.header}
      {items.length === 0 ? (
        <Text className="pt-6 text-sm text-foreground-muted">{props.emptyCopy}</Text>
      ) : (
        items.map((projected) => (
          <LeadTurnItem
            key={projected.item.id}
            threadRef={props.threadRef}
            environmentId={props.environmentId}
            projectId={props.projectId}
            item={projected.item}
            onOpenThread={props.onOpenThread}
          />
        ))
      )}
    </ScrollView>
  );
}

function LeadTurnItem(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly projectId: string;
  readonly item: OrchestrationV2TurnItem;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const { item } = props;
  switch (item.type) {
    case "user_message":
      return <LeadUserMessage item={item} />;
    case "assistant_message":
      return props.threadRef === null ? null : (
        <LeadAssistantMessage
          threadRef={props.threadRef}
          message={item}
          environmentId={props.environmentId}
          projectId={props.projectId}
          onOpenThread={props.onOpenThread}
        />
      );
    case "command_execution":
      return (
        <Text numberOfLines={1} className="text-xs text-foreground-muted">
          {`Ran ${item.input.split("\n")[0]?.slice(0, 120) ?? "a command"}`}
        </Text>
      );
    case "file_change":
      return (
        <Text numberOfLines={1} className="text-xs text-foreground-muted">
          {`Changed ${item.fileName}`}
        </Text>
      );
    default:
      return null;
  }
}

function LeadAssistantMessage(props: {
  readonly threadRef: ScopedThreadRef;
  readonly message: Extract<OrchestrationV2TurnItem, { readonly type: "assistant_message" }>;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly projectId: string;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const streamed = useAtomValue(
    environmentThreadDetails.assistantMessageTextAtom(props.threadRef, props.message.id),
  );
  const text = streamed ?? props.message.text;
  const liveMarkdown = useLiveThreadLinkLabels(text, props.environmentId);
  const styles = useMarkdownPreviewStyles();
  const openPullRequest = useOpenPullRequest({
    context: { environmentId: String(props.environmentId), projectId: props.projectId },
  });

  const onLinkPress = (href: string) => {
    const link = parseThreadLinkHref(href);
    if (link !== null) {
      const target = resolveThreadLink(
        (atom) => appAtomRegistry.get(atom),
        link,
        props.environmentId,
      );
      if (target !== null) props.onOpenThread(target);
      return;
    }
    void openPullRequest(href);
  };

  if (text.trim().length === 0 && !props.message.streaming) return null;
  return (
    <View className="gap-1">
      <SelectableMarkdownText
        markdown={liveMarkdown}
        textStyle={styles.nativeTextStyle}
        onLinkPress={onLinkPress}
      />
      {props.message.streaming ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          Writing…
        </Text>
      ) : null}
    </View>
  );
}

function LeadUserMessage(props: {
  readonly item: Extract<OrchestrationV2TurnItem, { readonly type: "user_message" }>;
}) {
  const records = props.item.context?.records ?? [];
  return (
    <View className="max-w-[90%] gap-1.5 self-end rounded-2xl bg-user-bubble px-3 py-2">
      <Text className="text-base text-user-bubble-foreground">{props.item.text}</Text>
      {records.length > 0 ? <LeadMessageContext records={records} /> : null}
    </View>
  );
}

function LeadMessageContext(props: { readonly records: ReadonlyArray<ComposerContextRecord> }) {
  return (
    <View className="flex-row flex-wrap gap-1">
      {props.records.map((record) => (
        <Chip key={leadContextKey(record)} size="small" label={record.label} />
      ))}
    </View>
  );
}
