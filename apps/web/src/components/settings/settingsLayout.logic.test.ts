import { describe, expect, it } from "vite-plus/test";

import { settingResetAriaLabel } from "./settingsLayout";

describe("settingResetAriaLabel", () => {
  it("names what the reset falls back to, and just what it resets otherwise", () => {
    const cases = [
      ["Architecture model", "Reset model", "Architecture model: Reset model"],
      [
        "Security delegation",
        "Reset to inherited value (Always)",
        "Security delegation: Reset to inherited value (Always)",
      ],
      ["Design instructions", "Reset to built-in", "Design instructions: Reset to built-in"],
      ["Security model", "Reset to inherited value", "Security model: Reset to inherited value"],
    ] as const;

    for (const [subject, tooltip, expected] of cases) {
      expect(settingResetAriaLabel(subject, tooltip)).toBe(expected);
    }
  });
});
