import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { leadScopeKey, resolveLeadOpenScope } from "@t3tools/client-runtime/lead/scope";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { CircleDotIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useEnvironments } from "../../state/environments";
import { useProject, useProjects, useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { LeadPanel } from "./LeadPanel";
import { useLeadPage } from "./useLeadPage";
import { useLeadPresentation } from "./useLeadPresentation";
import { useLeadSession } from "./useLeadSession";
import { useLeadUiStore } from "./leadUiStore";
import { Popover, PopoverPopup } from "../ui/popover";
import { Sheet, SheetPopup } from "../ui/sheet";
import { Button } from "../ui/button";

const RUNNING_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

function virtualAnchor() {
  return {
    getBoundingClientRect: () => new DOMRect(window.innerWidth - 24, 52, 0, 0),
  };
}

function restoreFocusTarget(element: HTMLElement | null): boolean {
  return (
    element !== null &&
    element.isConnected &&
    element.getClientRects().length > 0 &&
    element.closest("[inert]") === null
  );
}

function LeadProjectPicker({ onPick }: { readonly onPick: (scope: LeadScope) => void }) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const closeLead = useLeadUiStore((state) => state.closeLead);
  const environmentLabel = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
  return (
    <div className="flex min-h-0 flex-col" role="dialog" aria-label="Choose a project for the lead">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <CircleDotIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Which project?</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close lead"
          className="ms-auto"
          onClick={closeLead}
        >
          ×
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto p-1.5">
        {projects.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Add a project first. Each project gets its own lead.
          </p>
        ) : (
          projects.map((project) => (
            <button
              key={`${project.environmentId}:${project.id}`}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() =>
                onPick({ environmentId: project.environmentId, projectId: project.id })
              }
            >
              <span className="truncate">{project.title}</span>
              <span className="shrink-0 text-2xs text-muted-foreground">
                {environmentLabel.get(project.environmentId) ?? project.environmentId}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Mounted once in the app shell. The worker's ChatView stays mounted: the lead
 * is a sibling surface, never a route.
 */
export function LeadHost() {
  const { presentation, open, expanded } = useLeadPresentation();
  const page = useLeadPage();
  const retainedScope = useLeadUiStore((state) => state.retainedScope);
  const setRetainedScope = useLeadUiStore((state) => state.setRetainedScope);
  const setExpanded = useLeadUiStore((state) => state.setExpanded);
  const closeLead = useLeadUiStore((state) => state.closeLead);
  const markReplyRead = useLeadUiStore((state) => state.markReplyRead);
  const markReplyUnread = useLeadUiStore((state) => state.markReplyUnread);
  const anchorEl = useLeadUiStore((state) => state.anchorEl);
  const resolved = resolveLeadOpenScope({ retained: retainedScope, page: page.scope });
  const scope = resolved.scope;
  const project = useProject(
    scope === null ? null : scopeProjectRef(scope.environmentId, scope.projectId),
  );
  const session = useLeadSession(scope, { enabled: open });
  const scopeCanOperate = useEnvironmentScope(
    scope?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canOperate = scope !== null && scopeCanOperate;
  const leadThread = session.data?.thread ?? null;
  const bindingRef =
    scope === null || leadThread === null
      ? null
      : { environmentId: scope.environmentId, threadId: leadThread.threadId };
  const projection = useQuietThreadProjection(bindingRef);
  const running =
    projection?.projection.runs.some((run) => RUNNING_STATUSES.has(run.status)) ?? false;
  const previousRunning = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [anchorFallback] = useState(virtualAnchor);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers the first scope opened so reopening resumes it
  useEffect(() => {
    if (!open || scope === null) return;
    if (retainedScope === null || leadScopeKey(retainedScope) !== leadScopeKey(scope)) {
      setRetainedScope(scope);
    }
  }, [open, retainedScope, scope, setRetainedScope]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- returns focus to the invoker when the lead closes
  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement ? active : null;
      if (presentation === "compact") {
        const textarea = document.querySelector<HTMLTextAreaElement>("[data-lead-panel] textarea");
        textarea?.focus();
      }
    } else if (!open && wasOpen.current) {
      wasOpen.current = false;
      const target = returnFocus.current;
      if (restoreFocusTarget(target)) target?.focus();
      else document.querySelector<HTMLElement>("[data-lead-button]")?.focus();
      returnFocus.current = null;
    }
  }, [open, presentation]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks a reply that finishes while the lead is closed as unread
  useEffect(() => {
    if (!open && previousRunning.current && !running && scope !== null) {
      markReplyUnread(leadScopeKey(scope));
    }
    previousRunning.current = running;
  }, [markReplyUnread, open, running, scope]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the unread mark while the lead is open
  useEffect(() => {
    if (open && scope !== null) markReplyRead(leadScopeKey(scope));
  }, [markReplyRead, open, scope]);

  if (!open) return null;

  if (scope === null) {
    const picker = (
      <LeadProjectPicker
        onPick={(next) => {
          setRetainedScope(next);
        }}
      />
    );
    if (presentation === "phoneSheet") {
      return (
        <Sheet open onOpenChange={(next) => !next && closeLead()}>
          <SheetPopup side="bottom" showCloseButton={false} className="max-h-[70dvh]">
            {picker}
          </SheetPopup>
        </Sheet>
      );
    }
    return (
      <Popover open onOpenChange={(next) => !next && closeLead()} modal={false}>
        <PopoverPopup
          anchor={anchorEl ?? anchorFallback}
          side="bottom"
          align="end"
          padding="none"
          className="w-[min(27rem,calc(100vw-1.5rem))] overflow-hidden"
        >
          {picker}
        </PopoverPopup>
      </Popover>
    );
  }

  const projectLabel = project?.title ?? "Project";
  const panel = (
    <LeadPanel
      scope={scope}
      page={page}
      continuity={resolved.continuity}
      session={session}
      projectLabel={projectLabel}
      canOperate={canOperate}
      expanded={expanded}
      onSwitch={(next) => setRetainedScope(next)}
      onExpand={() => setExpanded(!expanded)}
      onClose={closeLead}
      onChanged={session.refresh}
    />
  );

  if (presentation === "docked") {
    return (
      <aside
        {...workspaceAreaProps("lead", 2, "Lead")}
        className="relative flex h-dvh w-[25rem] min-h-0 shrink-0 flex-col border-s border-border bg-background"
        aria-label={`${projectLabel} lead`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            closeLead();
          }
        }}
      >
        {panel}
      </aside>
    );
  }

  if (presentation === "slideOver" || presentation === "phoneSheet") {
    const phone = presentation === "phoneSheet";
    return (
      <Sheet open onOpenChange={(next) => !next && closeLead()}>
        <SheetPopup
          side={phone ? "bottom" : "right"}
          showCloseButton={false}
          className={
            phone ? "h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)]" : "w-[25rem] max-w-[100vw]"
          }
        >
          <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <Popover open onOpenChange={(next) => !next && closeLead()} modal={false}>
      <PopoverPopup
        anchor={anchorEl ?? anchorFallback}
        side="bottom"
        align="end"
        padding="none"
        className="w-[min(27rem,calc(100vw-1.5rem))] max-h-[min(40rem,calc(100dvh-4rem))] overflow-hidden"
      >
        <div className="flex min-h-0 max-h-[inherit] flex-1 flex-col overflow-hidden">{panel}</div>
      </PopoverPopup>
    </Popover>
  );
}
