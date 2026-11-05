import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  checkAvailability: vi.fn<() => Promise<boolean>>(),
  isParakeetAvailable: vi.fn<() => boolean>(),
  prepare: vi.fn<(id: number) => Promise<{ locale: string; mode: number }>>(),
  prepareParakeet: vi.fn<(id: number) => Promise<{ locale: string; mode: number }>>(),
  transcribe: vi.fn<(id: number, uri: string, locale: string, mode: number) => Promise<string>>(),
  cancel: vi.fn<(id: number) => Promise<void>>(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => ({ isAvailable: () => true, ...mocks }),
}));

import { getLocalVoiceTranscriber } from "./voiceTranscription.android";
import type { VoiceTranscriptionEngine } from "../lib/voiceTranscriptionEngine";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

it.each([false, true])(
  "waits for device support before offering a transcriber (%s)",
  async (supported) => {
    vi.resetAllMocks();
    const probe = deferred<boolean>();
    mocks.checkAvailability.mockReturnValue(probe.promise);
    let settled = false;
    const result = Promise.resolve(getLocalVoiceTranscriber()).then((transcriber) => {
      settled = true;
      return transcriber;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    probe.resolve(supported);
    expect((await result) !== null).toBe(supported);
  },
);

it.each(["preparation", "transcription"] as const)(
  "waits for native cancellation cleanup during %s before settling",
  async (phase) => {
    vi.resetAllMocks();
    mocks.checkAvailability.mockResolvedValue(true);
    const prepared = { locale: "en-US", mode: 1 };
    mocks.prepare.mockResolvedValue(prepared);
    const enteredCancellation = deferred<number>();
    const cleanup = deferred<void>();
    mocks.cancel.mockImplementation((id) => {
      enteredCancellation.resolve(id);
      return cleanup.promise;
    });
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const pending = deferred<void>();
    let operationId: number | undefined;
    const operation = (id: number) => {
      operationId = id;
      return pending.promise;
    };
    const transcriber = (await getLocalVoiceTranscriber())!;
    const transcription = phase === "transcription" ? await transcriber.prepare(options) : null;
    if (phase === "preparation")
      mocks.prepare.mockImplementation((id) => operation(id).then(() => prepared));
    else mocks.transcribe.mockImplementation((id) => operation(id).then(() => "Dictated text."));
    let settled = false;
    const result = (
      transcription
        ? transcription.transcribe("file:///recording.m4a", options)
        : transcriber.prepare(options)
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });

    controller.abort();
    expect(await enteredCancellation.promise).toBe(operationId);
    expect(settled).toBe(false);
    // The bridge may finish while cancellation is still closing the native recognizer.
    pending.resolve();
    cleanup.resolve();
    expect(await result).toMatchObject({ code: "cancelled" });
  },
);

it("applies the selected engine to the next recording without changing a prepared recording", async () => {
  vi.resetAllMocks();
  mocks.isParakeetAvailable.mockReturnValue(true);
  mocks.prepare.mockResolvedValue({ locale: "en-US", mode: 1 });
  mocks.prepareParakeet.mockResolvedValue({ locale: "en-US", mode: -1 });
  mocks.transcribe.mockImplementation(async (_id, _uri, _locale, mode) =>
    mode === -1 ? "Local speech" : "Google speech",
  );
  let selected: VoiceTranscriptionEngine = "google";
  const transcriber = (await getLocalVoiceTranscriber(() => selected))!;
  const options = { signal: new AbortController().signal };
  const google = await transcriber.prepare(options);
  selected = "parakeet";
  expect(await google.transcribe("file:///voice.m4a", options)).toBe("Google speech");
  const parakeet = await transcriber.prepare(options);
  expect(await parakeet.transcribe("file:///voice.m4a", options)).toBe("Local speech");
});

it("does not silently substitute Google when Parakeet is explicitly selected but unsupported", async () => {
  vi.resetAllMocks();
  mocks.isParakeetAvailable.mockReturnValue(false);
  mocks.checkAvailability.mockResolvedValue(true);
  const transcriber = (await getLocalVoiceTranscriber(() => "parakeet"))!;
  await expect(transcriber.prepare({ signal: new AbortController().signal })).rejects.toMatchObject(
    {
      code: "unsupported-locale",
    },
  );
});
