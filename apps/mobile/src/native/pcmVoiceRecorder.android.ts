import { requireOptionalNativeModule } from "expo";
import type { RecorderState, RecordingStatus } from "expo-audio";

import type {
  NativeVoiceRecorder,
  VoiceRecordingInput,
} from "../features/voice-input/lazyVoiceRecorder";

interface PcmRecordingState {
  readonly id: number;
  readonly uri: string | null;
  readonly canRecord: boolean;
  readonly isRecording: boolean;
  readonly durationMillis: number;
  readonly fileSize: number;
  readonly metering: number;
  readonly isFinished: boolean;
  readonly hasError: boolean;
  readonly error: string | null;
}

interface PcmRecordingModule {
  isPcmRecordingAvailable(): boolean;
  preparePcmRecording(id: number): Promise<PcmRecordingState>;
  startPcmRecording(id: number, forDurationSeconds: number): void;
  stopPcmRecording(id: number): Promise<PcmRecordingState>;
  releasePcmRecording(id: number): Promise<void>;
  getPcmRecordingStatus(id: number): PcmRecordingState | null;
  getPcmRecordingInputs(): ReadonlyArray<VoiceRecordingInput>;
  setPcmRecordingInput(id: number, uid: string): void;
  addListener(
    event: "pcmRecordingStatus",
    listener: (status: PcmRecordingState) => void,
  ): { remove(): void };
}

const native = requireOptionalNativeModule<Partial<PcmRecordingModule>>("T3VoiceTranscription");
let nextRecordingId = 0;

const emptyState = (id: number): PcmRecordingState => ({
  id,
  uri: null,
  canRecord: false,
  isRecording: false,
  durationMillis: 0,
  fileSize: 0,
  metering: -160,
  isFinished: false,
  hasError: false,
  error: null,
});

export function createPcmVoiceRecorder(): NativeVoiceRecorder<
  RecordingStatus,
  RecorderState
> | null {
  if (
    !native?.preparePcmRecording ||
    !native.startPcmRecording ||
    !native.stopPcmRecording ||
    !native.releasePcmRecording ||
    !native.getPcmRecordingStatus ||
    !native.getPcmRecordingInputs ||
    !native.setPcmRecordingInput ||
    !native.addListener ||
    native.isPcmRecordingAvailable?.() !== true
  )
    return null;
  const module = native as PcmRecordingModule;
  const listeners = new Set<(status: RecordingStatus) => void>();
  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  let currentId: number | null = null;
  let state = emptyState(0);
  let uri: string | null = null;
  let preparing: Promise<void> = Promise.resolve();
  let releasing: Promise<void> | null = null;
  let terminalQueued = false;

  const isCurrent = (id: number) => !disposed && currentId === id;
  const assertCurrent = (id: number) => {
    if (!isCurrent(id)) throw new Error("PCM voice recorder was released or replaced.");
  };
  const track = <T>(promise: Promise<T>) => {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  };
  const accept = (next: PcmRecordingState) => {
    if (!isCurrent(next.id)) return;
    state = next;
    uri = next.uri ?? uri;
  };
  const terminal = (next: PcmRecordingState) => {
    if (!isCurrent(next.id) || terminalQueued) return;
    accept(next);
    terminalQueued = true;
    // A synchronous start error must reach the controller after it enters recording.
    queueMicrotask(() => {
      if (!isCurrent(next.id)) return;
      const status: RecordingStatus = {
        id: String(next.id),
        isFinished: next.isFinished,
        hasError: next.hasError,
        error: next.error,
        url: next.uri,
        mediaServicesDidReset: false,
      };
      listeners.forEach((listener) => listener(status));
    });
  };
  const subscription = module.addListener("pcmRecordingStatus", terminal);

  return {
    get uri() {
      return uri;
    },
    prepareToRecordAsync() {
      if (disposed) return Promise.reject(new Error("PCM voice recorder was released."));
      const previousId = currentId;
      const previous = preparing;
      const id = ++nextRecordingId;
      currentId = id;
      state = emptyState(id);
      uri = null;
      terminalQueued = false;
      const cleanup =
        previousId === null ? Promise.resolve() : module.releasePcmRecording(previousId);
      preparing = track(
        (async () => {
          await Promise.all([previous.catch(() => {}), cleanup]);
          assertCurrent(id);
          const prepared = await module.preparePcmRecording(id);
          if (!isCurrent(id)) {
            await module.releasePcmRecording(id);
            assertCurrent(id);
          }
          if (prepared.id !== id)
            throw new Error("PCM voice recorder returned an invalid session.");
          accept(prepared);
          if (prepared.hasError)
            throw new Error(prepared.error ?? "PCM recording preparation failed.");
        })(),
      );
      return preparing;
    },
    record({ forDuration }) {
      if (currentId === null || disposed || !state.canRecord)
        throw new Error("PCM voice recorder is not prepared.");
      module.startPcmRecording(currentId, forDuration);
      const started = module.getPcmRecordingStatus(currentId);
      if (!started || started.hasError)
        throw new Error(started?.error ?? "PCM recording failed to start.");
      accept(started);
    },
    stop() {
      if (currentId === null || disposed) return Promise.resolve();
      const id = currentId;
      return track(
        module.stopPcmRecording(id).then((stopped) => {
          assertCurrent(id);
          if (stopped.id !== id) throw new Error("PCM voice recorder returned an invalid session.");
          accept(stopped);
          if (stopped.hasError) throw new Error(stopped.error ?? "PCM recording failed.");
        }),
      );
    },
    getStatus() {
      if (currentId !== null && !disposed) {
        const snapshot = module.getPcmRecordingStatus(currentId);
        if (snapshot) accept(snapshot);
        else if (state.canRecord || state.isRecording)
          terminal({
            ...state,
            canRecord: false,
            isRecording: false,
            hasError: true,
            error: "PCM recording was interrupted.",
          });
      }
      return {
        canRecord: !disposed && state.canRecord,
        isRecording: !disposed && state.isRecording,
        durationMillis: state.durationMillis,
        fileSize: state.fileSize,
        mediaServicesDidReset: false,
        metering: state.metering,
        url: uri,
      };
    },
    addListener(_event, listener) {
      if (!disposed) listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    getAvailableInputs: () => (disposed ? [] : module.getPcmRecordingInputs()),
    setInput(uid) {
      if (currentId === null || disposed) throw new Error("PCM voice recorder is not prepared.");
      module.setPcmRecordingInput(currentId, uid);
    },
    release() {
      if (releasing) return releasing;
      disposed = true;
      subscription.remove();
      listeners.clear();
      const cleanup =
        currentId === null ? Promise.resolve() : module.releasePcmRecording(currentId);
      releasing = Promise.all([cleanup, Promise.allSettled(pending)]).then(() => undefined);
      return releasing;
    },
  };
}
