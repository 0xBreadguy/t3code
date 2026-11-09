import { useAtomValue } from "@effect/atom-react";
import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { leadScopeKey } from "@t3tools/client-runtime/lead/scope";
import { deriveLeadButtonStatus } from "@t3tools/client-runtime/lead/status";
import { CircleDotIcon, ShieldCheckIcon, WifiOffIcon } from "lucide-react";

import { useLeadBackend } from "../../rpc/lead";
import { useStableCallback } from "../../hooks/useStableCallback";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { useProject } from "../../state/entities";
import { shortcutLabelForCommand } from "../../keybindings";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Toggle } from "../ui/toggle";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useLeadPage } from "./useLeadPage";
import { useLeadEnvironment, useLeadSession } from "./useLeadSession";
import { useLeadLiveState } from "./useLeadLiveState";
import { countLeadsNeedingYou, leadButtonLabelWithAttention } from "./leadAttention.logic";
import { useLeadAttention } from "./leadAttention";
import { useLeadUiStore } from "./leadUiStore";

function useLeadButtonScope(): {
  readonly scope: LeadScope | null;
  readonly page: ReturnType<typeof useLeadPage>;
} {
  const page = useLeadPage();
  const retained = useLeadUiStore((state) => state.retainedScope);
  return { scope: retained ?? page.scope, page };
}

/**
 * The always-available way to summon the lead. It is hidden while the lead is
 * expanded because the dock or sheet carries its own header controls.
 */
export function LeadButton({ className }: { readonly className?: string }) {
  const backend = useLeadBackend();
  const { scope } = useLeadButtonScope();
  const open = useLeadUiStore((state) => state.open);
  const expanded = useLeadUiStore((state) => state.expanded);
  const toggleLead = useLeadUiStore((state) => state.toggleLead);
  const setAnchorElement = useLeadUiStore((state) => state.setAnchorElement);
  const unreadScopeKeys = useLeadUiStore((state) => state.unreadScopeKeys);
  const { environments } = useEnvironments();
  const attention = useLeadAttention();
  const needsYouCount = countLeadsNeedingYou(attention);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "lead.toggle");
  const project = useProject(
    scope === null ? null : scopeProjectRef(scope.environmentId, scope.projectId),
  );
  const session = useLeadSession(scope);
  const environment = useLeadEnvironment(scope);
  const { state, pendingHandoffCount } = useLeadLiveState(scope, session.data, { enabled: open });
  const rememberAnchor = useStableCallback((element: HTMLElement | null) => {
    setAnchorElement(element);
  });
  const ownership = state?.ownership ?? null;
  const grantActive = ownership !== null && ownership.revokedAt === null;
  const pendingHandoffs = pendingHandoffCount;
  const status = deriveLeadButtonStatus({
    connectedEnvironmentCount: environments.length,
    scopes:
      scope === null
        ? []
        : [
            {
              scope,
              scopeLabel: project?.title ?? "this project",
              environmentLabel: environment.label ?? "this environment",
              needsYouCount,
              reportsToReviewCount: pendingHandoffs,
              grantActive,
              unreadReply: unreadScopeKeys.includes(leadScopeKey(scope)),
              offline: !environment.online,
            },
          ],
  });
  const label = leadButtonLabelWithAttention(status.label, attention);

  if (environments.length === 0) return null;
  if (expanded) return null;

  const capabilitySupported = environments.some(
    (environment) => backend.capability(environment.environmentId).kind === "supported",
  );
  const unavailable = !capabilitySupported;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className ?? "flex shrink-0"} />}>
        <Toggle
          variant="ghost"
          size="sm"
          pressed={open}
          aria-label={label}
          aria-expanded={open}
          aria-controls="lead-panel"
          aria-keyshortcuts="Meta+I Control+I"
          data-lead-button=""
          onPressedChange={() => toggleLead()}
          ref={rememberAnchor}
          className="[-webkit-app-region:no-drag]"
        >
          <span className="flex items-center gap-1.5">
            <CircleDotIcon className="size-4" />
            <span className="hidden sm:inline">Lead</span>
            {status.grantActive ? <ShieldCheckIcon className="size-3.5" /> : null}
            {status.offlineEnvironments.length > 0 ? <WifiOffIcon className="size-3.5" /> : null}
            {needsYouCount > 0 ? (
              <Badge size="sm" variant="warning">
                {needsYouCount}
              </Badge>
            ) : status.reportsToReviewCount > 0 ? (
              <Badge size="sm" variant="secondary">
                {status.reportsToReviewCount}
              </Badge>
            ) : null}
            {status.unreadReply ? (
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            ) : null}
          </span>
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {unavailable
          ? "The lead needs a newer server"
          : `Ask the lead${shortcutLabel ? ` (${shortcutLabel})` : ""}`}
      </TooltipPopup>
    </Tooltip>
  );
}
