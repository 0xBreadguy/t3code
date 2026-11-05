import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceInputController } from "@t3tools/client-runtime/voice-input";

import { createLazyVoiceRecorder, type VoiceRecordingInput } from "./lazyVoiceRecorder";

type Status = { readonly isFinished: boolean };
type State = { readonly isRecording: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createNativeRecorder(uri: string) {
  const listeners = new Set<(status: Status) => void>();
  return {
    uri: null as string | null,
    prepared: uri,
    prepareToRecordAsync: vi.fn(async function (this: { uri: string | null; prepared: string }) {
      this.uri = this.prepared;
    }),
    record: vi.fn(),
    stop: vi.fn(async (): Promise<void> => undefined),
    getStatus: vi.fn((): State => ({ isRecording: true })),
    addListener: vi.fn((_event: "recordingStatusUpdate", listener: (status: Status) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
    getAvailableInputs: vi.fn((): ReadonlyArray<VoiceRecordingInput> => [
      { uid: "car", name: "CarPlay", type: "CarAudio" },
      { uid: "built-in", name: "iPhone Microphone", type: "MicrophoneBuiltIn" },
    ]),
    setInput: vi.fn((_uid: string) => undefined),
    release: vi.fn(),
    emit: (status: Status) => listeners.forEach((listener) => listener(status)),
  };
}

function createHarness(
  selectInput?: (inputs: ReadonlyArray<VoiceRecordingInput>) => VoiceRecordingInput | null,
) {
  const created: Array<ReturnType<typeof createNativeRecorder>> = [];
  const statuses: Status[] = [];
  const recorder = createLazyVoiceRecorder({
    create: () => {
      const native = createNativeRecorder(`file:///voice-${created.length}.m4a`);
      created.push(native);
      return native;
    },
    onStatus: (status) => statuses.push(status),
    ...(selectInput ? { selectInput } : {}),
  });
  return { recorder, created, statuses };
}

describe("createLazyVoiceRecorder", () => {
  it("keeps the system input when none is preferred or the preferred one disconnects", async () => {
    const unpreferred = createHarness(() => null);
    await unpreferred.recorder.prepareToRecordAsync();
    expect(unpreferred.created[0]!.setInput).not.toHaveBeenCalled();

    const disconnected = createHarness((inputs) => inputs[1] ?? null);
    await disconnected.recorder.prepareToRecordAsync();
    disconnected.created[0]!.setInput.mockImplementationOnce(() => {
      throw new Error("Preferred input not found");
    });
    await expect(disconnected.recorder.prepareToRecordAsync()).resolves.toBeUndefined();
  });

  it("forwards status events until the recorder is released", async () => {
    const { recorder, created, statuses } = createHarness();
    await recorder.prepareToRecordAsync();
    const native = created[0]!;

    native.emit({ isFinished: true });
    recorder.release();
    native.emit({ isFinished: false });

    expect(statuses).toEqual([{ isFinished: true }]);
  });

  it("retains a finalized URI while cleanup finishes and reselects capture for the next recording", async () => {
    let engine = "google";
    const cleanup = deferred<void>();
    const retired = deferred<void>();
    const created: string[] = [];
    const recorder = createLazyVoiceRecorder({
      create: () => {
        created.push(engine);
        const native = createNativeRecorder(`file:///${engine}.wav`);
        native.release.mockImplementation(() => {
          native.uri = null;
          retired.resolve();
          return cleanup.promise;
        });
        return native;
      },
      onStatus: (_status: Status) => {},
    });
    await recorder.prepareToRecordAsync();
    await recorder.stop();
    const released = recorder.release();
    await retired.promise;
    expect(recorder.uri).toBe("file:///google.wav");
    engine = "parakeet";
    const next = recorder.prepareToRecordAsync();
    expect(created).toEqual(["google"]);
    cleanup.resolve();
    await released;
    await next;
    expect(created).toEqual(["google", "parakeet"]);
    expect(recorder.uri).toBe("file:///parakeet.wav");
  });

  it("retires a pending preparation without admitting late callbacks or losing its final URI", async () => {
    const prepared = deferred<void>();
    const entered = deferred<void>();
    const native = createNativeRecorder("file:///prepared.wav");
    let lateStatus: ((status: Status) => void) | undefined;
    native.addListener.mockImplementation((_event, listener) => {
      lateStatus = listener;
      return { remove: () => true };
    });
    native.prepareToRecordAsync.mockImplementation(async () => {
      entered.resolve();
      await prepared.promise;
      native.uri = native.prepared;
    });
    const statuses: Status[] = [];
    const recorder = createLazyVoiceRecorder({
      create: () => native,
      onStatus: (status: Status) => statuses.push(status),
    });
    const preparing = recorder.prepareToRecordAsync();
    await entered.promise;
    const rejected = expect(preparing).rejects.toThrow("released");
    const released = recorder.release();
    lateStatus?.({ isFinished: true });
    prepared.resolve();
    await rejected;
    await released;
    expect(recorder.uri).toBe("file:///prepared.wav");
    expect(recorder.getStatus()).toBeNull();
    expect(statuses).toEqual([]);
  });

  describe("with the voice input controller", () => {
    function createController(granted: boolean, releaseAfterRecording = false) {
      const harness = createHarness();
      const deleted: string[] = [];
      const transcribed: string[] = [];
      const controller = new VoiceInputController({
        recorder: harness.recorder,
        getTranscriber: () => ({
          prepare: async () => ({
            locale: "en-US",
            transcribe: async (uri) => {
              transcribed.push(uri);
              expect(harness.recorder.uri).toBe(uri);
              return "text";
            },
          }),
        }),
        requestPermission: async () => ({ granted, canAskAgain: true }),
        configureRecording: async () => undefined,
        releaseRecording: async () => {
          if (releaseAfterRecording) await harness.recorder.release();
        },
        deleteRecording: (uri) => deleted.push(uri),
        readDraft: () => ({
          ownerKey: "thread",
          text: "",
          selection: { start: 0, end: 0 },
          revision: 0,
        }),
        commitDraft: () => undefined,
        onStateChange: () => undefined,
      });
      return { ...harness, controller, deleted, transcribed };
    }

    it("does not create a native recorder when microphone permission is denied", async () => {
      const { controller, created } = createController(false);

      await controller.start();

      expect(controller.currentState.phase).toBe("error");
      expect(created).toHaveLength(0);
    });

    it("transcribes the retained URI after releasing capture and creates a recorder for the next dictation", async () => {
      const { controller, created, transcribed, deleted } = createController(true, true);
      await controller.start();
      await controller.stop();
      expect(controller.currentState.phase).toBe("idle");
      expect(transcribed).toEqual(["file:///voice-0.m4a"]);
      expect(deleted).toEqual(["file:///voice-0.m4a"]);

      await controller.start();
      expect(created).toHaveLength(2);
      expect(controller.currentState.phase).toBe("recording");
      await controller.stop();
    });
  });
});
