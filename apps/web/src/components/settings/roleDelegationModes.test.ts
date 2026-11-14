import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE,
  AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
  roleDelegationModeState,
  type RoleDelegationModeTarget,
} from "./roleDelegationModes";

const laptop: RoleDelegationModeTarget = {
  environmentLabel: "Laptop",
  hasModel: true,
};
const server: RoleDelegationModeTarget = {
  environmentLabel: "Server",
  hasModel: true,
};

describe("role delegation mode state", () => {
  it("waits for a role model before the mode means anything", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [{ environmentLabel: "Laptop", hasModel: false }],
      }).disabledReason,
    ).toBe("Choose a model for this role to set how it delegates.");
  });

  it("keeps a server that cannot store modes from accepting the write or its reset", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: false,
        targets: [laptop],
      }),
    ).toMatchObject({
      disabledReason: AGENT_ROLE_DELEGATION_MODES_UNSUPPORTED_MESSAGE,
      resetDisabled: true,
    });
  });

  it("disables the mode choices when no environment is connected", () => {
    const state = roleDelegationModeState({
      projectScope: false,
      modesSupported: true,
      targets: [],
    });
    expect(state.disabledReason).toBe(AGENT_ROLE_DELEGATION_MODES_NO_TARGETS_MESSAGE);
    expect(state.showReset).toBe(false);
  });

  it("keeps the saved mode resettable after its role model is removed", () => {
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [{ environmentLabel: "Laptop", hasModel: false, environmentMode: "always" }],
      }),
    ).toMatchObject({
      value: "always",
      disabledReason: "Choose a model for this role to set how it delegates.",
      resetDisabled: false,
      showReset: true,
      resetLabel: "Use default",
    });
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [{ environmentLabel: "Laptop", hasModel: false, projectMode: "always" }],
      }),
    ).toMatchObject({
      resetDisabled: false,
      showReset: true,
      resetLabel: "Use inherited",
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
      statusLine: "Inherited from Laptop.",
      showReset: false,
      resetLabel: "Use inherited",
    });
    expect(
      roleDelegationModeState({
        projectScope: true,
        modesSupported: true,
        targets: [{ ...laptop, environmentMode: "always", projectMode: "prefer" }],
      }),
    ).toMatchObject({
      value: "prefer",
      statusLine: "Set for this project.",
      showReset: true,
    });
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [laptop],
      }),
    ).toMatchObject({
      value: "prefer",
      statusLine: "Defaults to prefer.",
      showReset: false,
      resetLabel: "Use default",
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
      statusLine: "Mixed across selected environments. Choosing one sets it for all.",
    });
  });

  it("reports where a mode is set when several environments share one", () => {
    const state = roleDelegationModeState({
      projectScope: false,
      modesSupported: true,
      targets: [
        { ...laptop, environmentMode: "always" },
        { ...server, environmentMode: "always" },
      ],
    });
    expect(state.statusLine).toBe("Set on the selected environments.");
    expect(state.showReset).toBe(true);
    expect(
      roleDelegationModeState({
        projectScope: false,
        modesSupported: true,
        targets: [{ ...laptop, environmentMode: "prefer" }, server],
      }).statusLine,
    ).toBe("Set on some selected environments.");
  });
});
