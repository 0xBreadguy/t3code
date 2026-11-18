import * as Schema from "effect/Schema";
import { ExternalLinkIcon, MessagesSquareIcon } from "lucide-react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { ensureLocalApi, readLocalApi } from "../localApi";
import { waitForIdle } from "./GitHubStarPrompt";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

const ROLES_DISCUSSION_URL = "https://github.com/pingdotgg/t3code/discussions/38477";
// Separate keys so a count written by another tab can never undo a dismissal.
const SENT_KEY = "t3code:roles-discussion-prompt:sent";
const DISMISSED_KEY = "t3code:roles-discussion-prompt:dismissed";
const PROMPTS_BEFORE_ASKING = 3;

let shownThisSession = false;

function dismiss() {
  try {
    setLocalStorageItem(DISMISSED_KEY, true, Schema.Boolean);
  } catch {}
}

// Every close path, including both buttons, runs `onClose`, which saves the dismissal.
function showRolesDiscussionPrompt() {
  const close = () => toastManager.close(id);
  const openDiscussion = () => {
    close();
    void readLocalApi()
      ?.shell.openExternal(ROLES_DISCUSSION_URL)
      .catch(() => undefined);
  };
  const id = toastManager.add({
    title: "Should Roles be part of T3 Code?",
    description: "Tell the T3 Code team why or why not in the Roles discussion on GitHub.",
    timeout: 0,
    onClose: dismiss,
    actionProps: { children: "Open discussion", onClick: openDiscussion },
    data: {
      actionLayout: "stacked-end",
      leadingIcon: <MessagesSquareIcon aria-hidden className="size-4" />,
      secondaryActionProps: { children: "Dismiss", onClick: close },
      secondaryActionVariant: "ghost",
    },
  });
}

/**
 * Counts a sent prompt. After more than three, asks once per session whether Roles belong in T3
 * Code, until dismissed. Waits until the user is idle.
 */
export async function recordRolesDiscussionPromptSent(): Promise<void> {
  if (shownThisSession) return;
  try {
    if (getLocalStorageItem(DISMISSED_KEY, Schema.Boolean)) return;
    const sent = (getLocalStorageItem(SENT_KEY, Schema.Number) ?? 0) + 1;
    setLocalStorageItem(SENT_KEY, sent, Schema.Number);
    if (sent <= PROMPTS_BEFORE_ASKING) return;
  } catch {
    // Storage that cannot be read or written could not keep a dismissal, so never ask.
    return;
  }
  shownThisSession = true;
  await waitForIdle();
  try {
    // Another tab can dismiss while the idle wait runs.
    if (getLocalStorageItem(DISMISSED_KEY, Schema.Boolean)) return;
  } catch {
    return;
  }
  showRolesDiscussionPrompt();
}

export function RolesDiscussionButton() {
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      title="Should Roles be part of T3 Code? Say why or why not on GitHub."
      onClick={() => void ensureLocalApi().shell.openExternal(ROLES_DISCUSSION_URL)}
    >
      Discuss on GitHub
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
