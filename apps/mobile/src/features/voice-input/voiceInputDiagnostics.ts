import { Atom } from "effect/reactivity";

import type { VoiceTranscriptionEngine } from "../../lib/voiceTranscriptionEngine";

export type VoiceDictationMeasurement = {
  readonly id: number;
  readonly engine: VoiceTranscriptionEngine;
  readonly status: "complete" | "error" | "cancelled";
  readonly preparationMs?: number;
  readonly stopToCommitMs?: number;
};

export const VOICE_DICTATION_MEASUREMENT_LIMIT = 20;

export const voiceDictationMeasurementsAtom = Atom.make<ReadonlyArray<VoiceDictationMeasurement>>(
  [],
).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input:local-measurements"));
