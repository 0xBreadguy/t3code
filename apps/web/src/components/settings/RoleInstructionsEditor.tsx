import { AGENT_ROLE_INSTRUCTION_MAX_LENGTH, type AgentRole } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  roleInstructionState,
  roleInstructionSummaryLabel,
  type RoleInstructionTarget,
} from "./roleInstructions";
import { useUpdateScopedSettings } from "./useScopedSettings";

const COUNTER_THRESHOLD = AGENT_ROLE_INSTRUCTION_MAX_LENGTH * 0.9;

export function RoleInstructionsEditor({
  role,
  title,
  projectScope,
  targets,
  environmentLabel,
}: {
  readonly role: AgentRole;
  readonly title: string;
  readonly projectScope: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateScopedSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const undoAvailable = useRef(false);
  const editGeneration = useRef(0);
  const statusId = useId();
  const state = roleInstructionState({
    projectScope,
    targets,
    draft: draft ?? "",
    edited,
    environmentLabel,
  });
  const value = edited && draft !== null ? draft : state.resolvedText;
  const dirty = edited ? (state.mixed ? true : value !== state.resolvedText) : false;
  const tooLong = value.length > AGENT_ROLE_INSTRUCTION_MAX_LENGTH;
  const summary = roleInstructionSummaryLabel(state.summary, projectScope, targets[0]);
  const showCounter = value.length >= COUNTER_THRESHOLD;

  // A save is only complete once the persisted readback matches the draft.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the local draft after the settings readback proves the write landed
  useEffect(() => {
    if (!saving || state.mixed || draft === null || draft !== state.resolvedText) return;
    // oxlint-disable-next-line react/set-state-in-effect -- the readback is the external confirmation this effect exists for
    setSaving(false);
    setEdited(false);
    setDraft(null);
    setSaveError(null);
  }, [saving, state.mixed, state.resolvedText, draft]);

  const focusTextarea = () => textareaRef.current?.focus();
  const change = (next: string) => {
    editGeneration.current += 1;
    undoAvailable.current = false;
    setDraft(next);
    setEdited(true);
    setSaving(false);
    setSaveError(null);
  };
  const cancel = () => {
    setDraft(null);
    setEdited(false);
    setSaving(false);
    setSaveError(null);
    focusTextarea();
  };
  const save = () => {
    if (!dirty || tooLong || saving) return;
    editGeneration.current += 1;
    undoAvailable.current = false;
    setSaving(true);
    updateSettings(
      { agentRoleInstructions: { [role]: value } },
      {
        onFailed: () => {
          setSaving(false);
          setSaveError("Could not save. Your text is still here.");
        },
      },
    );
  };
  const reset = () => {
    if (saving) return;
    const previous = state.undoText;
    const resetGeneration = editGeneration.current;
    // Keep this render's writer so Undo targets the scope the reset was requested in,
    // even if the scope picker changes while the toast is visible.
    const updateResetScope = updateSettings;
    setDraft(null);
    setEdited(false);
    setSaving(true);
    setSaveError(null);
    updateResetScope(
      { agentRoleInstructions: { [role]: null } },
      {
        onFailed: () => {
          setSaving(false);
          setSaveError("Could not reset these instructions.");
        },
        onSaved: () => {
          setSaving(false);
          if (editGeneration.current !== resetGeneration) return;
          undoAvailable.current = previous !== undefined;
          toastManager.add({
            type: "success",
            title: `${title} instructions reset`,
            description: projectScope
              ? "This project now inherits its instructions again."
              : "T3's built-in instructions now apply.",
            ...(previous === undefined
              ? {}
              : {
                  actionProps: {
                    children: "Undo",
                    onClick: () => {
                      if (!undoAvailable.current) return;
                      undoAvailable.current = false;
                      setSaving(true);
                      setSaveError(null);
                      updateResetScope(
                        { agentRoleInstructions: { [role]: previous } },
                        {
                          onFailed: () => {
                            setSaving(false);
                            setSaveError("Could not restore these instructions.");
                          },
                          onSaved: () => setSaving(false),
                        },
                      );
                    },
                  },
                }),
          });
        },
      },
    );
    focusTextarea();
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span>
          <span className="sr-only">{title} </span>
          Instructions
          <span className="sr-only">, </span>
        </span>
        <span className="font-normal text-muted-foreground/80">{summary}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pb-3">
          <Textarea
            ref={textareaRef}
            aria-label={`${title} instructions`}
            aria-describedby={statusId}
            aria-invalid={tooLong}
            value={value}
            placeholder={
              state.mixed
                ? "Mixed. Type instructions to save to every selected environment."
                : "No extra instructions. T3's role framing still applies."
            }
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                save();
                return;
              }
              if (event.key === "Escape" && dirty) {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
          <div className="flex flex-col gap-2 pt-2.5 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <p id={statusId} role="status" className="text-xs text-muted-foreground">
                {saveError ?? (dirty ? "Unsaved changes" : state.statusLine)}
              </p>
              {tooLong ? (
                <p className="text-xs text-destructive">
                  Instructions must be {AGENT_ROLE_INSTRUCTION_MAX_LENGTH.toLocaleString()}{" "}
                  characters or fewer.
                </p>
              ) : showCounter ? (
                <p className="text-xs text-muted-foreground">
                  {value.length.toLocaleString()} /{" "}
                  {AGENT_ROLE_INSTRUCTION_MAX_LENGTH.toLocaleString()} characters
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-center">
              {state.showReset ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${state.resetLabel} ${title} instructions`}
                  disabled={saving}
                  onClick={reset}
                >
                  {state.resetLabel}
                </Button>
              ) : null}
              {state.canStartFromBuiltIn && state.builtInText !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Start ${title} instructions from built-in text`}
                  onClick={() => {
                    change(state.builtInText ?? "");
                    focusTextarea();
                  }}
                >
                  Start from built-in
                </Button>
              ) : null}
              <div className="grid grid-cols-2 gap-2 @min-[32rem]/settings-row:flex @min-[32rem]/settings-row:items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Cancel ${title} instruction changes`}
                  disabled={!dirty}
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  aria-label={`Save ${title} instructions`}
                  disabled={!dirty || tooLong || saving}
                  onClick={() => {
                    save();
                    focusTextarea();
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
