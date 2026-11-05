import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";
import type { VoiceTranscriptionEngine } from "../lib/voiceTranscriptionEngine";
import type { VoiceTranscriptionDiagnostics } from "./voiceTranscriptionDiagnostics";

export async function getLocalVoiceTranscriber(
  _getEngine?: () => VoiceTranscriptionEngine,
): Promise<VoiceTranscriber | null> {
  return null;
}

export async function getVoiceTranscriptionDiagnostics(): Promise<VoiceTranscriptionDiagnostics | null> {
  return null;
}
