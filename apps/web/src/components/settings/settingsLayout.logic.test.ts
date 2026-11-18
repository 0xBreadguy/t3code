import { describe, expect, it } from "vite-plus/test";

import { settingResetAriaLabel } from "./settingsLayout";

describe("settingResetAriaLabel", () => {
  it("names what the reset falls back to, and just what it resets otherwise", () => {
    const cases = [
      ["Architecture model", "Reset model", "Reset Architecture model"],
      [
        "Security delegation",
        "Reset to inherited value (Always)",
        "Reset Security delegation to inherited value (Always)",
      ],
      ["Design instructions", "Reset to built-in", "Reset Design instructions to built-in"],
      ["Security model", "Reset to inherited value", "Reset Security model to inherited value"],
    ] as const;

    for (const [subject, tooltip, expected] of cases) {
      expect(settingResetAriaLabel(subject, tooltip)).toBe(expected);
    }
  });
});
