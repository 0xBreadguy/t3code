import { T, useGT, useMessages } from "gt-react";
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
import { SettingResetButton, settingResetAriaLabel } from "./settingsLayout";
import { useUpdateScopedSettings } from "./useScopedSettings";

const COUNTER_THRESHOLD = AGENT_ROLE_INSTRUCTION_MAX_LENGTH * 0.9;

export function RoleInstructionsEditor({
  role,
  title,
  projectScope,
  targets,
}: {
  readonly role: AgentRole;
  readonly title: string;
  readonly projectScope: boolean;
  readonly targets: ReadonlyArray<RoleInstructionTarget>;
}) {
  const gt = useGT();
  const messages = useMessages();
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
  const state = roleInstructionState(
    {
      projectScope,
      targets,
      draft: draft ?? "",
      edited,
    },
    messages,
  );
  const value = edited && draft !== null ? draft : state.resolvedText;
  const dirty = edited ? (state.mixed ? true : value !== state.resolvedText) : false;
  const tooLong = value.length > AGENT_ROLE_INSTRUCTION_MAX_LENGTH;
  const summary = roleInstructionSummaryLabel(state.summary, messages);
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
          setSaveError(gt("Could not save. Your text is still here."));
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
          setSaveError(gt("Could not reset these instructions."));
        },
        onSaved: () => {
          setSaving(false);
          if (editGeneration.current !== resetGeneration) return;
          undoAvailable.current = previous !== undefined;
          toastManager.add({
            type: "success",
            title: gt("{role} instructions reset", { role: title }),
            description: projectScope
              ? gt("This project now inherits its instructions again.")
              : gt("T3's built-in instructions now apply."),
            ...(previous === undefined
              ? {}
              : {
                  actionProps: {
                    children: gt("Undo"),
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
                            setSaveError(gt("Could not restore these instructions."));
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
      <div className="mt-3 flex min-h-8 items-center gap-1.5">
        <CollapsibleTrigger className="group inline-flex min-h-8 items-center gap-1.5 rounded-md text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
          />
          <span className="sr-only">{gt("{role} instructions", { role: title })}, </span>
          <span aria-hidden>
            <T>Instructions</T>
          </span>
          <span className="font-normal text-muted-foreground/80">{summary}</span>
        </CollapsibleTrigger>
        {state.showReset ? (
          <SettingResetButton
            ariaLabel={settingResetAriaLabel(
              gt("{role} instructions", { role: title }),
              state.resetTooltip,
              messages,
            )}
            tooltip={state.resetTooltip}
            disabled={saving}
            onClick={reset}
          />
        ) : null}
      </div>
      <CollapsiblePanel>
        <div className="pb-3">
          <Textarea
            ref={textareaRef}
            aria-label={gt("{role} instructions", { role: title })}
            aria-describedby={statusId}
            aria-invalid={tooLong}
            inherited={state.inherited}
            value={value}
            placeholder={
              state.mixed
                ? gt("Mixed. Type instructions to save to every selected environment.")
                : gt("No extra instructions. T3's role framing still applies.")
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
                {saveError ?? (dirty ? gt("Unsaved changes") : state.statusLine)}
              </p>
              {tooLong ? (
                <p className="text-xs text-destructive">
                  {gt("Instructions must be {limit} characters or fewer.", {
                    limit: AGENT_ROLE_INSTRUCTION_MAX_LENGTH.toLocaleString(),
                  })}
                </p>
              ) : showCounter ? (
                <p className="text-xs text-muted-foreground">
                  {gt("{count} / {limit} characters", {
                    count: value.length.toLocaleString(),
                    limit: AGENT_ROLE_INSTRUCTION_MAX_LENGTH.toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-center">
              {state.canStartFromBuiltIn && state.builtInText !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={gt("Start {role} instructions from built-in text", { role: title })}
                  onClick={() => {
                    change(state.builtInText ?? "");
                    focusTextarea();
                  }}
                >
                  <T>Start from built-in</T>
                </Button>
              ) : null}
              <div className="grid grid-cols-2 gap-2 @min-[32rem]/settings-row:flex @min-[32rem]/settings-row:items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={gt("Cancel {role} instruction changes", { role: title })}
                  disabled={!dirty}
                  onClick={cancel}
                >
                  <T>Cancel</T>
                </Button>
                <Button
                  size="sm"
                  aria-label={gt("Save {role} instructions", { role: title })}
                  disabled={!dirty || tooLong || saving}
                  onClick={() => {
                    save();
                    focusTextarea();
                  }}
                >
                  <T>Save</T>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
