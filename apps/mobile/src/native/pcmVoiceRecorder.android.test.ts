import { expect, it, vi } from "vite-plus/test";
import type { RecordingStatus } from "expo-audio";

type PcmState = {
  id: number;
  uri: string | null;
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
  fileSize: number;
  metering: number;
  isFinished: boolean;
  hasError: boolean;
  error: string | null;
};

const native = vi.hoisted(() => ({
  isPcmRecordingAvailable: vi.fn<() => boolean>(),
  preparePcmRecording: vi.fn<(id: number) => Promise<PcmState>>(),
  startPcmRecording: vi.fn<(id: number, seconds: number) => void>(),
  stopPcmRecording: vi.fn<(id: number) => Promise<PcmState>>(),
  releasePcmRecording: vi.fn<(id: number) => Promise<void>>(),
  getPcmRecordingStatus: vi.fn<(id: number) => PcmState | null>(),
  getPcmRecordingInputs: vi.fn(() => [
    { uid: "built-in", name: "Pixel", type: "MicrophoneBuiltIn" },
  ]),
  setPcmRecordingInput: vi.fn<(id: number, uid: string) => void>(),
  addListener: vi.fn<(event: string, listener: (state: PcmState) => void) => { remove(): void }>(),
}));

vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));

import { createPcmVoiceRecorder } from "./pcmVoiceRecorder.android";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function pcm(id: number, overrides: Partial<PcmState> = {}): PcmState {
  return {
    id,
    uri: `file:///pcm-${id}.wav`,
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    fileSize: 44,
    metering: -160,
    isFinished: false,
    hasError: false,
    error: null,
    ...overrides,
  };
}

function setup() {
  vi.resetAllMocks();
  const states = new Map<number, PcmState>();
  const released = new Set<number>();
  const listeners = new Set<(state: PcmState) => void>();
  let lastListener: ((state: PcmState) => void) | undefined;
  native.isPcmRecordingAvailable.mockReturnValue(true);
  native.preparePcmRecording.mockImplementation(async (id) => {
    const prepared = pcm(id);
    states.set(id, prepared);
    return prepared;
  });
  native.startPcmRecording.mockImplementation((id) => {
    if (released.has(id)) throw new Error("Session released");
    states.set(id, { ...states.get(id)!, isRecording: true });
  });
  native.stopPcmRecording.mockImplementation(async (id) => {
    const stopped = { ...states.get(id)!, canRecord: false, isRecording: false, isFinished: true };
    states.set(id, stopped);
    return stopped;
  });
  native.releasePcmRecording.mockImplementation(async (id) => {
    released.add(id);
    states.delete(id);
  });
  native.getPcmRecordingStatus.mockImplementation((id) => states.get(id) ?? null);
  native.addListener.mockImplementation((_event, listener) => {
    lastListener = listener;
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  const recorder = createPcmVoiceRecorder()!;
  const statuses: RecordingStatus[] = [];
  recorder.addListener("recordingStatusUpdate", (status) => statuses.push(status));
  return {
    recorder,
    states,
    released,
    statuses,
    emit: (state: PcmState) => listeners.forEach((listener) => listener(state)),
    emitLate: (state: PcmState) => lastListener?.(state),
  };
}

it("offers the old-client fallback only when PCM capture is unavailable", () => {
  setup();
  native.isPcmRecordingAvailable.mockReturnValue(false);
  expect(createPcmVoiceRecorder()).toBeNull();
});

it("maps live metering and retains the finalized URI only after stop completes", async () => {
  const { recorder, states } = setup();
  await recorder.prepareToRecordAsync();
  const id = [...states.keys()][0]!;
  recorder.record({ forDuration: 300 });
  states.set(
    id,
    pcm(id, { isRecording: true, durationMillis: 800, fileSize: 25644, metering: -12 }),
  );
  expect(recorder.getStatus()).toEqual({
    canRecord: true,
    isRecording: true,
    durationMillis: 800,
    fileSize: 25644,
    metering: -12,
    mediaServicesDidReset: false,
    url: `file:///pcm-${id}.wav`,
  });
  const finalizing = deferred<PcmState>();
  native.stopPcmRecording.mockReturnValueOnce(finalizing.promise);
  const stopping = recorder.stop();
  expect(recorder.getStatus().isRecording).toBe(true);
  const final = pcm(id, {
    uri: "file:///final.wav",
    canRecord: false,
    isFinished: true,
    durationMillis: 1000,
    fileSize: 32044,
  });
  states.set(id, final);
  finalizing.resolve(final);
  await stopping;
  expect(recorder.uri).toBe("file:///final.wav");
  expect(recorder.getStatus()).toMatchObject({ isRecording: false, durationMillis: 1000 });
  await recorder.release();
  expect(recorder.uri).toBe("file:///final.wav");
});

it("uses a fresh session on each prepare and filters stale or queued terminal events", async () => {
  const { recorder, states, released, statuses, emit } = setup();
  await recorder.prepareToRecordAsync();
  const first = [...states.keys()][0]!;
  emit(pcm(first, { isFinished: true }));
  const preparing = recorder.prepareToRecordAsync();
  await preparing;
  const second = [...states.keys()][0]!;
  expect(second).toBeGreaterThan(first);
  expect(released.has(first)).toBe(true);
  emit(pcm(first, { hasError: true, error: "Old error" }));
  const terminal = pcm(second, { canRecord: false, isFinished: true, durationMillis: 300000 });
  emit(terminal);
  emit(terminal);
  await Promise.resolve();
  expect(statuses).toEqual([
    {
      id: String(second),
      isFinished: true,
      hasError: false,
      error: null,
      url: terminal.uri,
      mediaServicesDidReset: false,
    },
  ]);
  await recorder.release();
});

it("releases cancelled preparation and rejects its late completion without resurrecting state", async () => {
  const { recorder, released, statuses, emitLate } = setup();
  const entered = deferred<number>();
  const preparation = deferred<PcmState>();
  native.preparePcmRecording.mockImplementation((id) => {
    entered.resolve(id);
    return preparation.promise;
  });
  const preparing = recorder.prepareToRecordAsync();
  const id = await entered.promise;
  const rejection = expect(preparing).rejects.toThrow("released");
  const disposing = recorder.release();
  expect(released.has(id)).toBe(true);
  emitLate(pcm(id, { isFinished: true }));
  preparation.resolve(pcm(id));
  await rejection;
  await disposing;
  expect(recorder.uri).toBeNull();
  expect(recorder.getStatus()).toMatchObject({ isRecording: false, canRecord: false });
  expect(statuses).toEqual([]);
  await expect(recorder.prepareToRecordAsync()).rejects.toThrow("released");
});

it.each(["prepare", "release"] as const)(
  "ignores a late stop and event after %s",
  async (action) => {
    const { recorder, states, statuses, emit } = setup();
    await recorder.prepareToRecordAsync();
    const first = [...states.keys()][0]!;
    recorder.record({ forDuration: 300 });
    const finalizing = deferred<PcmState>();
    native.stopPcmRecording.mockReturnValueOnce(finalizing.promise);
    const stopping = recorder.stop();
    const rejection = expect(stopping).rejects.toThrow("replaced");
    const transition = action === "prepare" ? recorder.prepareToRecordAsync() : recorder.release();
    if (action === "prepare") await transition;
    const second = [...states.keys()][0];
    finalizing.resolve(pcm(first, { uri: "file:///stale.wav", isFinished: true }));
    emit(pcm(first, { isFinished: true }));
    await rejection;
    await transition;
    expect(recorder.uri).toBe(`file:///pcm-${action === "prepare" ? second : first}.wav`);
    expect(statuses).toEqual([]);
    await recorder.release();
  },
);

it("waits for superseded preparation cleanup before admitting its replacement", async () => {
  const { recorder, states, released } = setup();
  const entered = deferred<number>();
  const oldPreparation = deferred<PcmState>();
  native.preparePcmRecording.mockImplementationOnce((id) => {
    entered.resolve(id);
    return oldPreparation.promise;
  });
  const first = recorder.prepareToRecordAsync();
  const id = await entered.promise;
  const rejection = expect(first).rejects.toThrow("replaced");
  const second = recorder.prepareToRecordAsync();
  expect(released.has(id)).toBe(true);
  expect(states.size).toBe(0);
  oldPreparation.resolve(pcm(id, { uri: "file:///stale.wav" }));
  await rejection;
  await second;
  const next = [...states.keys()][0]!;
  expect(next).toBeGreaterThan(id);
  expect(recorder.uri).toBe(`file:///pcm-${next}.wav`);
  await recorder.release();
});

it("reports a missing active native session as an interruption instead of recording forever", async () => {
  const { recorder, states, statuses } = setup();
  await recorder.prepareToRecordAsync();
  recorder.record({ forDuration: 300 });
  states.clear();
  expect(recorder.getStatus().isRecording).toBe(false);
  await Promise.resolve();
  expect(statuses).toMatchObject([{ hasError: true, error: "PCM recording was interrupted." }]);
  await recorder.release();
});

it("does not hide a native preparation error behind an AAC substitution", async () => {
  const { recorder } = setup();
  native.preparePcmRecording.mockImplementation(async (id) =>
    pcm(id, { hasError: true, error: "No microphone" }),
  );
  await expect(recorder.prepareToRecordAsync()).rejects.toThrow("No microphone");
  await recorder.release();
});
