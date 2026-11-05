import { requireOptionalNativeModule } from "expo";
import type { VoiceTranscriptionEngine } from "../lib/voiceTranscriptionEngine";
import type { VoiceTranscriptionDiagnostics } from "./voiceTranscriptionDiagnostics";

import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

type PreparedAndroidTranscription = { readonly locale: string; readonly mode: number };

const native = requireOptionalNativeModule<{
  isAvailable(): boolean;
  isParakeetAvailable?(): boolean;
  checkAvailability(): Promise<boolean>;
  prepare(id: number): Promise<PreparedAndroidTranscription>;
  prepareParakeet?(id: number): Promise<PreparedAndroidTranscription>;
  getDiagnostics?(): Promise<VoiceTranscriptionDiagnostics | null>;
  transcribe(id: number, uri: string, locale: string, mode: number): Promise<string>;
  cancel(id: number): Promise<void>;
}>("T3VoiceTranscription");

let nextOperationId = 0;

export async function getVoiceTranscriptionDiagnostics(): Promise<VoiceTranscriptionDiagnostics | null> {
  return native?.getDiagnostics?.() ?? null;
}

export async function getLocalVoiceTranscriber(
  getEngine: () => VoiceTranscriptionEngine = () => "google",
): Promise<VoiceTranscriber | null> {
  if (!native?.isAvailable()) return null;
  const parakeetAvailable = native.isParakeetAvailable?.() === true && !!native.prepareParakeet;
  if (!parakeetAvailable && !(await native.checkAvailability())) return null;
  const module = native;
  return {
    prepare: async ({ signal }) => {
      const engine = getEngine();
      if (engine === "parakeet" && !parakeetAvailable) {
        throw new VoiceTranscriptionError(
          "unsupported-locale",
          "Parakeet requires an updated Android build and an English device language.",
        );
      }
      const prepared = await runOperation(signal, "preparation-failed", (id) =>
        engine === "parakeet" ? module.prepareParakeet!(id) : module.prepare(id),
      );
      return {
        locale: prepared.locale,
        transcribe: (uri, { signal }) =>
          runOperation(signal, "transcription-failed", (id) =>
            module.transcribe(id, uri, prepared.locale, prepared.mode),
          ),
      };
    },
  };
}

async function runOperation<T>(
  signal: AbortSignal,
  errorCode: "preparation-failed" | "transcription-failed",
  operation: (id: number) => Promise<T>,
): Promise<T> {
  throwIfVoiceTranscriptionAborted(signal);
  const id = ++nextOperationId;
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    cancellation = native!.cancel(id).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await operation(id);
    throwIfVoiceTranscriptionAborted(signal);
    return result;
  } catch (error) {
    throwIfVoiceTranscriptionAborted(signal);
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    throw new VoiceTranscriptionError(
      code === "unavailable" || code === "unsupported-locale" ? code : errorCode,
      code === "unavailable"
        ? "On-device voice transcription is not available for this device language."
        : errorCode === "preparation-failed"
          ? "Voice transcription could not prepare the selected speech model."
          : "Voice transcription failed.",
      { cause: error },
    );
  } finally {
    signal.removeEventListener("abort", abort);
    await cancellation;
  }
}
