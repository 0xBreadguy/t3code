import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LEAD_SHEET_DETENTS, leadSheetContentHeight } from "./leadSheetHeight";

export function useLeadSheetContentHeight(): {
  readonly height: number;
  readonly onLayout: (event: LayoutChangeEvent) => void;
} {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [detentIndex, setDetentIndex] = useState(0);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the native sheet detent so the content matches the visible height
  useEffect(() => {
    return navigation.addListener("sheetDetentChange", ({ data }) => {
      setDetentIndex(data.index);
    });
  }, [navigation]);

  return {
    height: leadSheetContentHeight({
      detentIndex,
      detents: LEAD_SHEET_DETENTS,
      bottomInset: insets.bottom,
      windowHeight,
      containerHeight,
    }),
    onLayout: (event) => {
      const next = event.nativeEvent.layout.height;
      setContainerHeight((current) =>
        current === null || Math.abs(current - next) >= 1 ? next : current,
      );
    },
  };
}
