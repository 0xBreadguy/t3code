import type { EnvironmentId, TipId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, LightbulbIcon, XIcon } from "lucide-react";
import { use, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import {
  persistClientSettingsUpdate,
  useClientSettings,
  useClientSettingsHydrated,
} from "~/hooks/useSettings";
import { useAllEnvironmentShellsBootstrapped, useServerConfigs } from "~/state/entities";
import { useConnectedEnvironmentIds } from "~/state/environments";
import { useEnvironmentSessionsSettled } from "~/state/session";
import { TIP_BY_ID, TIPS, type Tip, type TipAction } from "~/tips/catalog";
import { deckStartIndex } from "~/tips/tipsState";
import { canStoreTips, readTipsState } from "~/tips/tipsStorage";
import { markTipOpened, markTipShown, runTipsVisit, setTipDismissed } from "~/tips/tipsStore";
import { settingsSearchHash } from "../settings/settingsSearch";
import { Button, InlineButton } from "../ui/button";
import { toastManager } from "../ui/toast";
import { BackgroundThreadContext } from "./backgroundThread";

/**
 * Tips under the new-thread composer. The strip is picked once per visit, so it never
 * changes while the user types, and arrows browse it only while focus is inside it.
 */
export function NewThreadTips({
  environmentId,
  projectId,
  readyDrivers,
  composerDriver,
  onTryPrompt,
}: {
  environmentId: EnvironmentId;
  projectId: string | null;
  /** Comma-separated drivers ready for the draft's project, or undefined while they load. */
  readyDrivers: string | undefined;
  composerDriver: string | null;
  onTryPrompt: (prompt: string) => void;
}) {
  const enabled = useClientSettings((settings) => settings.newThreadTipsEnabled);
  const settingsReady = useClientSettingsHydrated();
  const shellsReady = useAllEnvironmentShellsBootstrapped();
  // Configs and permissions decide which tips can work, and voice may run on any connected
  // machine; picking before they load would spend the day's tip on a later one. The draft's own
  // machine always counts, even before it shows as connected.
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const pickMachines = [
    environmentId,
    ...connectedEnvironmentIds.filter((id) => id !== environmentId),
  ];
  const configs = useServerConfigs();
  const configReady = pickMachines.every((id) => configs.has(id));
  const sessionReady = useEnvironmentSessionsSettled(pickMachines);
  // Out of flow under the composer: a short or narrow window has no room for it.
  const roomy = useMediaQuery("(height > 34rem) and (min-width: 40rem)");
  // Under Settings the strip is covered; unmounting it there also picks up any change made in
  // Settings when the user comes back.
  const background = use(BackgroundThreadContext);
  if (background || !enabled || !roomy) return null;
  // A draft can move to another project or environment; its tips depend on both.
  return (
    <TipsStrip
      key={`${environmentId}:${projectId}`}
      environmentId={environmentId}
      ready={settingsReady && shellsReady && configReady && sessionReady}
      readyDrivers={readyDrivers}
      composerDriver={composerDriver}
      onTryPrompt={onTryPrompt}
    />
  );
}

function TipsStrip({
  environmentId,
  ready,
  readyDrivers,
  composerDriver,
  onTryPrompt,
}: {
  environmentId: EnvironmentId;
  /**
   * Whether what the pick reads has loaded. Checked only until the pick, so a machine that
   * connects later never unmounts an open strip and its Undo.
   */
  ready: boolean;
  readyDrivers: string | undefined;
  composerDriver: string | null;
  onTryPrompt: (prompt: string) => void;
}) {
  // Picked once per draft, after it is on screen and its project's providers have loaded, so it
  // never changes while the user types or switches tabs.
  const [deck, setDeck] = useState<ReadonlyArray<TipId> | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- picks tips from localStorage once the page is visible; a hidden page would spend today's tip
  useEffect(() => {
    if (deck !== null || !ready || readyDrivers === undefined) return;
    const pick = () => {
      if (document.visibilityState !== "visible") return;
      setDeck(canStoreTips() ? runTipsVisit(environmentId, new Set(readyDrivers.split(","))) : []);
    };
    const frame = requestAnimationFrame(pick);
    document.addEventListener("visibilitychange", pick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", pick);
    };
  }, [deck, environmentId, ready, readyDrivers]);
  if (deck === null || deck.length === 0) return null;
  return (
    <TipsCarousel
      deck={deck}
      environmentId={environmentId}
      composerDriver={composerDriver}
      onTryPrompt={onTryPrompt}
    />
  );
}

function TipsCarousel({
  deck,
  environmentId,
  composerDriver,
  onTryPrompt,
}: {
  deck: ReadonlyArray<TipId>;
  environmentId: EnvironmentId;
  composerDriver: string | null;
  onTryPrompt: (prompt: string) => void;
}) {
  const navigate = useNavigate();
  // Start on the oldest tip not yet seen, so each one gets its turn without the arrows.
  const [index, setIndex] = useState(() => deckStartIndex(TIPS, deck, readTipsState()));
  const [hidden, setHidden] = useState<ReadonlySet<TipId>>(new Set());
  const [boringSidebarTurnedOn, setBoringSidebarTurnedOn] = useState(false);
  const boringSidebarOn = useClientSettings((settings) => settings.boringSidebarEnabled);
  const tip = TIP_BY_ID.get(deck[Math.min(index, deck.length - 1)]!)!;
  const isHidden = hidden.has(tip.id);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the first time a tip is on screen in localStorage and analytics
  useEffect(() => {
    if (!isHidden) markTipShown(tip.id, environmentId);
  }, [tip.id, isHidden, environmentId]);

  const sectionRef = useRef<HTMLElement>(null);
  // Changing tips replaces the focused button; keep focus in the strip so the arrows still work.
  const keepFocus = () => sectionRef.current?.focus();
  const go = (step: number) =>
    setIndex((current) => Math.max(0, Math.min(deck.length - 1, current + step)));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Modified arrows belong to the browser and OS, such as Alt+Left for Back.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    keepFocus();
    go(event.key === "ArrowLeft" ? -1 : 1);
  };
  const setHiddenFor = (hide: boolean) => {
    keepFocus();
    if (!setTipDismissed(tip.id, hide, environmentId)) return;
    setHidden((current) => {
      const next = new Set(current);
      if (hide) next.add(tip.id);
      else next.delete(tip.id);
      return next;
    });
  };
  const setBoringSidebar = (on: boolean) => {
    keepFocus();
    // The next visit records it as done if it is still on, so Undo leaves no trace. The strip
    // says it is on only once the setting is saved.
    persistClientSettingsUpdate((current) => ({ ...current, boringSidebarEnabled: on })).then(
      () => setBoringSidebarTurnedOn(on),
      () => toastManager.add({ type: "error", title: "Could not save the sidebar setting" }),
    );
  };
  const runAction = (action: TipAction) => {
    markTipOpened(tip.id, environmentId);
    if (action.kind === "boring-sidebar") setBoringSidebar(true);
    else if (action.kind === "prompt") onTryPrompt(action.prompt);
    else if (action.kind === "setting")
      void navigate({
        to: action.to,
        hash: settingsSearchHash(action.target),
        // Per-machine settings open on the draft's machine, not every environment.
        ...(action.scoped ? { search: { machine: environmentId } } : {}),
        hashScrollIntoView: false,
        state: { settingsTargetHighlight: true },
      });
  };

  const boringDone = tip.id === "boring-sidebar" && boringSidebarTurnedOn;
  return (
    <section
      ref={sectionRef}
      aria-roledescription="carousel"
      aria-label="Tips"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex items-start gap-3 rounded-md px-1 text-xs leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {tip.id === "boring-sidebar" && !isHidden && !boringDone ? (
        <BoringSidebarPreview />
      ) : boringDone ? (
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <LightbulbIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div aria-live="polite">
          {isHidden ? (
            <p className="text-muted-foreground">Tip hidden. Find it again in Settings → Tips.</p>
          ) : boringDone ? (
            <p className="font-medium text-foreground">Boring sidebar is on.</p>
          ) : (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{tip.lead}</span> {tip.body}
            </p>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {isHidden ? (
            <InlineButton onClick={() => setHiddenFor(false)}>Undo</InlineButton>
          ) : boringDone ? (
            <InlineButton onClick={() => setBoringSidebar(false)}>Undo</InlineButton>
          ) : (
            <TipActions
              key={tip.id}
              tip={withoutDoneActions(tip, boringSidebarOn)}
              composerDriver={composerDriver}
              onAction={runAction}
            />
          )}
          <span className="ms-auto">
            <InlineButton
              tone="muted"
              // Settings checks the draft's machine, as the strip does.
              onClick={() =>
                void navigate({ to: "/settings/tips", search: { machine: environmentId } })
              }
            >
              All tips
            </InlineButton>
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground tabular-nums">
        {deck.length > 1 ? (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous tip"
              aria-disabled={index === 0 || undefined}
              onClick={() => go(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span>
              <span aria-hidden>
                {index + 1}/{deck.length}
              </span>
              <span className="sr-only">
                Tip {index + 1} of {deck.length}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next tip"
              aria-disabled={index === deck.length - 1 || undefined}
              onClick={() => go(1)}
            >
              <ChevronRightIcon />
            </Button>
          </>
        ) : null}
        {isHidden || boringDone ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Hide this tip"
            onClick={() => setHiddenFor(true)}
          >
            <XIcon />
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * Drops "Turn it on" when Boring sidebar is already on, as after clearing "Tried it": Undo would
 * then turn off a choice the user made before.
 */
export const withoutDoneActions = (tip: Tip, boringSidebarOn: boolean): Tip =>
  tip.id === "boring-sidebar" && boringSidebarOn
    ? { ...tip, actions: tip.actions.filter((action) => action.kind !== "boring-sidebar") }
    : tip;

/** The tip's actions. Settings shows prompts as copy buttons, since it has no composer. */
export function TipActions({
  tip,
  onAction,
  composerDriver = null,
}: {
  tip: Tip;
  onAction: (action: TipAction) => void;
  /** The composer's provider, or null where there is no composer to fill. */
  composerDriver?: string | null;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "tip text" });
  return tip.actions.map((action) => {
    if (action.kind === "link") {
      return (
        <InlineButton
          key={action.label}
          render={<a href={action.href} target="_blank" rel="noreferrer noopener" />}
          onClick={() => onAction(action)}
        >
          {action.label}
        </InlineButton>
      );
    }
    const copyText =
      action.kind === "copy"
        ? action.text
        : action.kind === "prompt" &&
            (composerDriver === null ||
              (action.driver !== undefined && action.driver !== composerDriver))
          ? action.prompt
          : null;
    if (copyText !== null) {
      return (
        <InlineButton
          key={action.label}
          onClick={() => {
            copyToClipboard(copyText, undefined);
            // Report a copy, so a copied prompt never also lands in the composer.
            onAction({ kind: "copy", label: action.label, text: copyText });
          }}
        >
          {isCopied ? "Copied" : action.kind === "prompt" ? "Copy prompt" : action.label}
        </InlineButton>
      );
    }
    return (
      <InlineButton key={action.label} onClick={() => onAction(action)}>
        {action.label}
      </InlineButton>
    );
  });
}

const PREVIEW_FOLDERS = [
  { name: "website", threads: ["Fix the signup form", "Dark mode"] },
  { name: "api", threads: ["Bump deps"] },
];

/** A drawn sample of the grouped sidebar. It follows the theme, unlike a screenshot. */
function BoringSidebarPreview() {
  return (
    <div
      aria-hidden
      className="flex w-24 shrink-0 flex-col gap-0.5 text-3xs leading-tight text-muted-foreground"
    >
      {PREVIEW_FOLDERS.map((folder) => (
        <div key={folder.name}>
          <div className="truncate font-semibold text-foreground">{folder.name}</div>
          {folder.threads.map((thread) => (
            <div key={thread} className="truncate ps-2">
              {thread}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
