import type { VoiceInputPhase, VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { memo } from "react";
import { Linking, Pressable, Text as SystemText, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { cn } from "../../lib/cn";
import type { VoiceComposerPresentation } from "./voiceInputPresentation";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";

const DICTATION_TIMING = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const WAVEFORM_BAR_HEIGHT = 32;
const WAVEFORM_MIN_BAR_HEIGHT = 2;
const WAVEFORM_TIMING = {
  duration: 100,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
} as const;

const WaveformBar = memo(function WaveformBar(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly sampleIndex: number;
  readonly height?: number;
}) {
  const { audioLevels, sampleIndex } = props;
  const height = props.height ?? WAVEFORM_BAR_HEIGHT;
  const animatedStyle = useAnimatedStyle(() => {
    const level = audioLevels.value[sampleIndex] ?? 0;
    return {
      opacity: withTiming(0.22 + level * 0.78, WAVEFORM_TIMING),
      transform: [
        {
          scaleY: withTiming(
            (WAVEFORM_MIN_BAR_HEIGHT + level * (height - WAVEFORM_MIN_BAR_HEIGHT)) / height,
            WAVEFORM_TIMING,
          ),
        },
      ],
    };
  });

  return (
    <Animated.View
      className="w-0.5 rounded-full bg-foreground"
      style={[{ height }, animatedStyle]}
    />
  );
});

const COMPACT_WAVEFORM_BAR_COUNT = 8;
const COMPACT_WAVEFORM_BAR_HEIGHT = 14;

export const CompactVoiceWaveform = memo(function CompactVoiceWaveform(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-0.5"
      style={{ height: COMPACT_WAVEFORM_BAR_HEIGHT }}
    >
      {Array.from({ length: COMPACT_WAVEFORM_BAR_COUNT }, (_, index) => (
        <WaveformBar
          key={index}
          audioLevels={props.audioLevels}
          height={COMPACT_WAVEFORM_BAR_HEIGHT}
          sampleIndex={VOICE_WAVEFORM_SAMPLE_COUNT - COMPACT_WAVEFORM_BAR_COUNT + index}
        />
      ))}
    </View>
  );
});

/** Use system tabular figures; DM Sans lacks them and would jitter. */
export function DictationElapsedTime(props: {
  readonly seconds: number;
  readonly className?: string;
}) {
  return (
    <SystemText
      className={cn("text-xs", props.className)}
      numberOfLines={1}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {Math.floor(props.seconds / 60)}:{String(props.seconds % 60).padStart(2, "0")}
    </SystemText>
  );
}

function VoiceActionButton(props: {
  readonly size?: "regular" | "large";
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly icon: AppSymbolName;
  readonly loading?: boolean;
  readonly onPress: () => void;
  readonly variant?: "plain" | "primary";
}) {
  const { scale } = useAndroidControlSizing();
  const variant = props.variant ?? "plain";
  const loading = props.loading === true;
  const large = props.size === "large";
  const circleSize = Math.round((large ? 44 : 30) * scale);
  const iconSize = Math.round(
    (variant === "primary" ? (large ? 20 : 16) : large ? 24 : 20) * scale,
  );
  const primaryStyle = useAnimatedStyle(() => ({
    opacity: withTiming(loading ? 0 : 1, DICTATION_TIMING),
  }));

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.loading, disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center active:opacity-70"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        opacity: props.disabled && !props.loading ? 0.4 : 1,
        // Matches ComposerActionButton so the circle stays concentric with the large composer corner.
        // An undefined width would still override the class's 44px width.
        ...(variant === "primary" && large ? { width: 62 } : null),
      }}
    >
      <View
        className={cn(
          "items-center justify-center",
          variant === "primary" ? "rounded-full bg-subtle" : "size-[44px]",
        )}
        style={variant === "primary" ? { width: circleSize, height: circleSize } : undefined}
      >
        {variant === "primary" ? (
          <Animated.View
            className="absolute inset-0 rounded-full bg-primary"
            style={primaryStyle}
          />
        ) : null}
        <View className="absolute inset-0 items-center justify-center">
          {props.loading ? (
            <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
          ) : (
            <SymbolView
              name={props.icon}
              size={iconSize}
              weight={variant === "primary" ? "semibold" : "regular"}
              tintColorClassName={
                variant === "primary" ? "accent-primary-foreground" : "accent-icon"
              }
              type="monochrome"
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function ComposerDictationError(props: {
  readonly error: string | null;
  readonly onDismiss: () => void;
}) {
  if (!props.error) return null;
  return (
    <View className="min-w-0 flex-row items-center gap-2 px-4 py-3">
      <Text accessibilityRole="alert" className="min-w-0 flex-1 text-sm text-danger-foreground">
        {props.error}
      </Text>
      <Pressable
        accessibilityLabel="Dismiss voice input error"
        accessibilityRole="button"
        className="size-7 items-center justify-center active:opacity-70"
        hitSlop={8}
        onPress={props.onDismiss}
      >
        <SymbolView
          name="xmark"
          size={12}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}

export function ComposerDictationStatus(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly elapsedSeconds: number;
  readonly phase: VoiceInputPhase;
  readonly presentation: VoiceComposerPresentation;
}) {
  if (!props.presentation.statusLabel || props.presentation.statusKind === "error") return null;
  return (
    <View
      accessible
      accessibilityLabel={props.presentation.statusLabel}
      accessibilityLiveRegion={props.phase === "recording" ? "none" : "polite"}
      className="h-11 min-w-0 shrink flex-row items-center gap-2 px-1"
    >
      {props.phase === "recording" ? (
        <>
          <CompactVoiceWaveform audioLevels={props.audioLevels} />
          <DictationElapsedTime className="text-foreground-muted" seconds={props.elapsedSeconds} />
        </>
      ) : (
        <Text className="shrink text-xs text-foreground-muted" numberOfLines={1}>
          {props.presentation.statusLabel}
        </Text>
      )}
    </View>
  );
}

export function ComposerDictationCancelAction(props: {
  readonly size?: "regular" | "large";
  readonly presentation: VoiceComposerPresentation;
  readonly onCancel: () => void;
}) {
  if (props.presentation.leadingAction !== "cancel") return null;
  return (
    <VoiceActionButton
      size={props.size}
      accessibilityLabel="Cancel dictation"
      icon="xmark"
      onPress={props.onCancel}
    />
  );
}

export function ComposerDictationPrimaryAction(props: {
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly presentation: VoiceComposerPresentation;
  readonly isAvailable: boolean;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  if (props.presentation.trailingAction === "confirm") {
    return (
      <VoiceActionButton
        size={props.size}
        accessibilityLabel={
          props.presentation.confirmationEnabled
            ? "Finish dictation"
            : (props.presentation.statusLabel ?? "Preparing voice input")
        }
        disabled={!props.presentation.confirmationEnabled}
        icon="checkmark"
        loading={!props.presentation.confirmationEnabled}
        onPress={props.onConfirm}
        variant="primary"
      />
    );
  }

  return <ComposerDictationStartAction {...props} />;
}

export function ComposerDictationStartAction(props: {
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly isAvailable: boolean;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}) {
  if (!props.isAvailable) return null;
  const openSettings = props.state.phase === "error" && props.state.errorAction === "settings";
  return (
    <VoiceActionButton
      size={props.size}
      accessibilityLabel={openSettings ? "Open microphone settings" : "Start dictation"}
      disabled={props.disabled}
      icon="mic"
      onPress={
        openSettings
          ? () => {
              props.onCancel();
              void Linking.openSettings();
            }
          : props.onStart
      }
    />
  );
}
