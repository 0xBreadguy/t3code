import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useLeadUiStore } from "./leadUiStore";

const PHONE_QUERY = "(max-width: 639px)";
// 36rem of work + the 25rem dock; below this the slide-over keeps the work usable.
const DOCK_QUERY = "(min-width: 1280px)";

export type LeadPresentation = "closed" | "compact" | "phoneSheet" | "docked" | "slideOver";

export function useLeadPresentation(): {
  readonly presentation: LeadPresentation;
  readonly open: boolean;
  readonly expanded: boolean;
} {
  const open = useLeadUiStore((state) => state.open);
  const expanded = useLeadUiStore((state) => state.expanded);
  const phone = useMediaQuery(PHONE_QUERY);
  const wide = useMediaQuery(DOCK_QUERY);
  if (!open) return { presentation: "closed", open, expanded };
  if (!expanded) {
    return {
      presentation: phone ? "phoneSheet" : "compact",
      open,
      expanded,
    };
  }
  return {
    presentation: wide ? "docked" : "slideOver",
    open,
    expanded,
  };
}
