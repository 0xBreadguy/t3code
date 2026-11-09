import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useCallback } from "react";

import { useEnvironments } from "../../state/environments";

export interface LeadSheetTarget {
  readonly environmentId: EnvironmentId | string;
  readonly threadId: ThreadId | string;
}

/**
 * The one way entry points summon the lead. It is not a route the user browses
 * to: without a connected environment there is nothing to lead, so callers hide
 * their control.
 */
export function useOpenLeadSheet(): {
  readonly available: boolean;
  readonly open: (target?: LeadSheetTarget) => void;
} {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const available = environments.length > 0;
  const open = useCallback(
    (target?: LeadSheetTarget) => {
      if (!available) return;
      navigation.navigate(
        "LeadSheet",
        target === undefined
          ? {}
          : {
              environmentId: String(target.environmentId),
              threadId: String(target.threadId),
            },
      );
    },
    [available, navigation],
  );
  return { available, open };
}
