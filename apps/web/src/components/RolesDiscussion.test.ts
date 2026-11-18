import { describe, expect, it, vi } from "vite-plus/test";

import type { toastManager } from "./ui/toast";

const { add } = vi.hoisted(() => ({ add: vi.fn<typeof toastManager.add>() }));
vi.mock("./ui/toast", () => ({ toastManager: { add, update: vi.fn(), close: vi.fn() } }));
vi.mock("../localApi", () => ({ readLocalApi: () => undefined, ensureLocalApi: vi.fn() }));
vi.mock("./GitHubStarPrompt", () => ({ waitForIdle: async () => {} }));

function setup({ sent = 0, writable = true } = {}) {
  add.mockReset();
  const store = new Map([["t3code:roles-discussion-prompt:sent", String(sent)]]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (!writable) throw new Error("QuotaExceededError");
        store.set(key, value);
      },
    },
  });
}

// A fresh module import stands in for an app reload; storage survives it.
async function startSession() {
  vi.resetModules();
  const session = await import("./RolesDiscussion");
  return {
    send: () => session.recordRolesDiscussionPromptSent(),
  };
}

describe("recordRolesDiscussionPromptSent", () => {
  it("asks after three prompts, once per session, and never again once closed", async () => {
    setup();
    let session = await startSession();
    for (let sent = 0; sent < 3; sent++) await session.send();
    expect(add).not.toHaveBeenCalled();

    await session.send();
    await session.send();
    expect(add).toHaveBeenCalledOnce();

    session = await startSession();
    await session.send();
    expect(add).toHaveBeenCalledTimes(2);

    add.mock.lastCall?.[0].onClose?.();
    session = await startSession();
    for (let sent = 0; sent < 10; sent++) await session.send();
    expect(add).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("never asks when a dismissal could not be saved", async () => {
    setup({ sent: 3, writable: false });
    await (await startSession()).send();
    expect(add).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
