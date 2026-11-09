import { leadContextKey, type LeadPageContext } from "@t3tools/client-runtime/lead/context";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import type { ComposerContextRecord } from "@t3tools/contracts";
import { View } from "react-native";

import { Chip } from "../../components/ui/Chip";
import {
  dismissLeadAutoContext,
  reattachLeadAutoContext,
  removeLeadDraftContext,
} from "./leadDraftModel";
import { updateLeadDrafts } from "./leadDrafts";
import { useLeadComposerContext } from "./useLeadContext";

/**
 * Semantic records only. There is deliberately no screenshot or screen reading;
 * a chip from another machine blocks sending until it is removed.
 */
export function LeadContextChips(props: {
  readonly scope: LeadScope | null;
  readonly page: LeadPageContext | null;
}) {
  const { auto, records, unreadable, dismissedAuto } = useLeadComposerContext(
    props.scope,
    props.page,
  );
  const scope = props.scope;
  if (scope === null) return null;
  const autoKeys = new Set(auto.map(leadContextKey));
  const unreadableKeys = new Set(unreadable.map(leadContextKey));

  const remove = (record: ComposerContextRecord) => {
    const key = leadContextKey(record);
    updateLeadDrafts((drafts) =>
      autoKeys.has(key)
        ? dismissLeadAutoContext(drafts, scope, key)
        : removeLeadDraftContext(drafts, scope, key),
    );
  };

  if (records.length === 0 && dismissedAuto.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-1.5">
      {records.map((record) => {
        const key = leadContextKey(record);
        const label = unreadableKeys.has(key) ? `${record.label} · unavailable here` : record.label;
        return (
          <Chip
            key={key}
            size="small"
            label={label}
            trailingIcon="xmark"
            onPress={() => remove(record)}
            accessibilityLabel={`Remove context: ${record.label}`}
          />
        );
      })}
      {dismissedAuto.map((record) => (
        <Chip
          key={leadContextKey(record)}
          size="small"
          label={`Attach ${record.label}`}
          icon="plus"
          onPress={() =>
            updateLeadDrafts((drafts) =>
              reattachLeadAutoContext(drafts, scope, leadContextKey(record)),
            )
          }
          accessibilityLabel={`Attach ${record.label}`}
        />
      ))}
    </View>
  );
}
