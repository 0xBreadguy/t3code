import type { LeadScope } from "@t3tools/client-runtime/lead/scope";
import { create } from "zustand";

export type LeadHostedView = "none" | "roles";

interface LeadUiState {
  open: boolean;
  expanded: boolean;
  retainedScope: LeadScope | null;
  anchorEl: HTMLElement | null;
  unreadScopeKeys: ReadonlyArray<string>;
  hostedView: LeadHostedView;
  openLead: (explicitScope?: LeadScope | null) => void;
  closeLead: () => void;
  toggleLead: (explicitScope?: LeadScope | null) => void;
  setExpanded: (expanded: boolean) => void;
  setRetainedScope: (scope: LeadScope) => void;
  setAnchorElement: (element: HTMLElement | null) => void;
  markReplyRead: (scopeKey: string) => void;
  markReplyUnread: (scopeKey: string) => void;
  setHostedView: (view: LeadHostedView) => void;
}

export const useLeadUiStore = create<LeadUiState>()((set, get) => ({
  open: false,
  expanded: false,
  retainedScope: null,
  anchorEl: null,
  unreadScopeKeys: [],
  hostedView: "none",
  openLead: (explicitScope) =>
    set((state) => ({
      open: true,
      retainedScope: explicitScope ?? state.retainedScope,
      hostedView: "none",
    })),
  closeLead: () => set({ open: false, expanded: false, hostedView: "none" }),
  toggleLead: (explicitScope) => {
    if (get().open) {
      get().closeLead();
      return;
    }
    get().openLead(explicitScope);
  },
  setExpanded: (expanded) => set({ expanded }),
  setRetainedScope: (scope) => set({ retainedScope: scope }),
  setAnchorElement: (element) => set({ anchorEl: element }),
  markReplyRead: (scopeKey) =>
    set((state) =>
      state.unreadScopeKeys.includes(scopeKey)
        ? { unreadScopeKeys: state.unreadScopeKeys.filter((key) => key !== scopeKey) }
        : state,
    ),
  markReplyUnread: (scopeKey) =>
    set((state) =>
      state.unreadScopeKeys.includes(scopeKey)
        ? state
        : { unreadScopeKeys: [...state.unreadScopeKeys, scopeKey] },
    ),
  setHostedView: (hostedView) => set({ hostedView }),
}));
