import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE,
  AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
  roleDelegationModeState,
  type RoleDelegationModeTarget,
} from "./roleDelegationModes";

const laptop: RoleDelegationModeTarget = {
  hasModel: true,
};
const server: RoleDelegationModeTarget = {
  hasModel: true,
};

describe("role delegation mode state", () => {
  it("waits for a role model before the mode means anything", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [{ hasModel: false }],
      }).note,
    ).toBe("Choose a model for this role to set how it delegates.");
  });

  it("keeps a server that cannot store modes from accepting the write or its reset", () => {
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: false,
        targets: [{ ...laptop, projectMode: "always" }],
      }),
    ).toMatchObject({
      disabledReason: AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
      note: AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
      resetDisabled: true,
      showReset: true,
    });
  });

  it("disables the mode choices when no environment is connected", () => {
    const state = roleDelegationModeState({
      projectScope: false,
      modesSupported: true,
      targets: [],
    });
    expect(state.disabledReason).toBe(AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE);
    expect(state.note).toBe(AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE);
    expect(state.showReset).toBe(false);
  });

  it("keeps a saved project mode resettable after its role model is removed", () => {
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [{ hasModel: false, projectMode: "always" }],
      }),
    ).toMatchObject({
      value: "always",
      disabledReason: "Choose a model for this role to set how it delegates.",
      resetDisabled: false,
      showReset: true,
      resetTooltip: "Reset to inherited value (Prefer)",
    });
  });

  it("never offers a reset outside project scope, even with a saved mode", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [{ ...laptop, environmentMode: "always" }],
      }),
    ).toMatchObject({
      value: "always",
      note: null,
      showReset: false,
    });
  });

  it("reads the project override, then the environment, then prefer", () => {
    const inherited = roleDelegationModeState({
      projectScope: true,
      modesSupported: true,
      targets: [{ ...laptop, environmentMode: "always" }],
    });
    expect(inherited).toMatchObject({
      value: "always",
      mixed: false,
      note: null,
      showReset: false,
      resetTooltip: "Reset to inherited value (Always)",
    });
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [{ ...laptop, environmentMode: "always", projectMode: "prefer" }],
      }),
    ).toMatchObject({
      value: "prefer",
      note: null,
      showReset: true,
      resetTooltip: "Reset to inherited value (Always)",
    });
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [laptop],
      }),
    ).toMatchObject({
      value: "prefer",
      note: null,
      showReset: false,
      resetTooltip: "Reset to inherited value (Prefer)",
    });
  });

  it("shows mixed environments without pretending one mode is chosen", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [laptop, { ...server, environmentMode: "always" }],
      }),
    ).toMatchObject({
      mixed: true,
      value: null,
      note: "Mixed across selected environments. Choosing one sets it for all.",
    });
  });

  it("names the inherited value a project reset falls back to", () => {
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [
          { ...laptop, environmentMode: "always" },
          { ...server, environmentMode: "always" },
        ],
      }),
    ).toMatchObject({
      note: null,
      showReset: false,
      resetTooltip: "Reset to inherited value (Always)",
    });
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [
          { ...laptop, environmentMode: "prefer" },
          { ...server, environmentMode: "always" },
        ],
      }).resetTooltip,
    ).toBe("Reset to inherited value");
  });
});
