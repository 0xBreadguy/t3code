import type { VoiceRecorder } from "@t3tools/client-runtime/voice-input";

type Subscription = { remove(): void };

export interface VoiceRecordingInput {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

export interface NativeVoiceRecorder<TStatus, TRecorderState> {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(options: { readonly forDuration: number }): void;
  stop(): Promise<void>;
  getStatus(): TRecorderState;
  addListener(
    eventName: "recordingStatusUpdate",
    listener: (status: TStatus) => void,
  ): Subscription;
  getAvailableInputs(): ReadonlyArray<VoiceRecordingInput>;
  setInput(uid: string): void;
  release(): void | Promise<void>;
}

export interface LazyVoiceRecorder<TRecorderState> extends VoiceRecorder {
  getStatus(): TRecorderState | null;
  release(): Promise<void>;
}

/** Construct lazily: cold startup blocks JS for tens of milliseconds and most composers never record. */
export function createLazyVoiceRecorder<TStatus, TRecorderState>(input: {
  readonly create: () => NativeVoiceRecorder<TStatus, TRecorderState>;
  readonly onStatus: (status: TStatus) => void;
  readonly selectInput?: (inputs: ReadonlyArray<VoiceRecordingInput>) => VoiceRecordingInput | null;
}): LazyVoiceRecorder<TRecorderState> {
  let recorder: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let subscription: Subscription | null = null;
  let retired: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let retiredUri: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  let cleanup: Promise<void> = Promise.resolve();
  let generation = 0;

  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending = Promise.allSettled([pending, promise]).then(() => undefined);
    return promise;
  };

  return {
    get uri() {
      if (recorder) return recorder.uri;
      return retired ? retired.uri : retiredUri;
    },
    prepareToRecordAsync() {
      const preparingGeneration = generation;
      return track(
        cleanup.then(async () => {
          if (preparingGeneration !== generation) throw new Error("Voice recorder was released.");
          if (!recorder) {
            const created = input.create();
            recorder = created;
            subscription = created.addListener("recordingStatusUpdate", (status) => {
              if (recorder === created && generation === preparingGeneration)
                input.onStatus(status);
            });
          }
          const prepared = recorder;
          await prepared.prepareToRecordAsync();
          if (recorder !== prepared || preparingGeneration !== generation)
            throw new Error("Voice recorder was released.");
          if (!input.selectInput) return;
          try {
            const selected = input.selectInput(prepared.getAvailableInputs());
            if (selected) prepared.setInput(selected.uid);
          } catch {}
        }),
      );
    },
    record(options) {
      if (!recorder) throw new Error("Voice recorder is not prepared.");
      recorder.record(options);
    },
    stop() {
      return recorder ? track(recorder.stop()) : Promise.resolve();
    },
    getStatus() {
      return recorder ? recorder.getStatus() : null;
    },
    release() {
      generation += 1;
      const released = recorder;
      recorder = null;
      subscription?.remove();
      subscription = null;
      if (released) retired = released;
      cleanup = pending.then(async () => {
        if (!released) return;
        if (retired === released) {
          retiredUri = released.uri;
          retired = null;
        }
        await released.release();
      });
      track(cleanup);
      return cleanup;
    },
  };
}
