import type { RecorderState, RecordingStatus } from "expo-audio";

import type { NativeVoiceRecorder } from "../features/voice-input/lazyVoiceRecorder";

export function createPcmVoiceRecorder(): NativeVoiceRecorder<
  RecordingStatus,
  RecorderState
> | null {
  return null;
}
