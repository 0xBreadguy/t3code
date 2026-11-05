export interface VoiceTranscriptionDiagnostics {
  readonly engine: string;
  readonly status?: string;
  readonly preparationMs?: number;
  readonly decodeMs?: number;
  readonly inferenceMs?: number;
  readonly totalMs?: number;
  readonly audioSampleRateHz?: number;
  readonly audioDurationSeconds?: number;
  readonly audioSourceMime?: string;
}
