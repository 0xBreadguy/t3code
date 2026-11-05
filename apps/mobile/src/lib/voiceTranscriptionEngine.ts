export type VoiceTranscriptionEngine = "google" | "parakeet";

export const DEFAULT_VOICE_TRANSCRIPTION_ENGINE: VoiceTranscriptionEngine = "google";

export function isVoiceTranscriptionEngine(value: unknown): value is VoiceTranscriptionEngine {
  return value === "google" || value === "parakeet";
}
