import { describe, expect, it } from "vite-plus/test";

import { LEAD_SHEET_DETENTS, leadSheetContentHeight } from "./leadSheetHeight";

describe("lead sheet content height", () => {
  const base = {
    detents: LEAD_SHEET_DETENTS,
    bottomInset: 24,
    windowHeight: 873,
    containerHeight: null,
  };

  it("uses the visible detent instead of the sheet's largest height", () => {
    expect(leadSheetContentHeight({ ...base, detentIndex: 0 })).toBe(456);
    expect(leadSheetContentHeight({ ...base, detentIndex: 1 })).toBe(779);
  });

  it("keeps matching the detent after measurement and viewport changes", () => {
    expect(leadSheetContentHeight({ ...base, containerHeight: 779, detentIndex: 0 })).toBe(456);
    const landscape = { ...base, windowHeight: 411, bottomInset: 16 };
    expect(leadSheetContentHeight({ ...landscape, detentIndex: 0 })).toBe(210);
    expect(leadSheetContentHeight({ ...landscape, detentIndex: 1 })).toBe(362);
  });

  it("clamps an out-of-range native detent index", () => {
    expect(leadSheetContentHeight({ ...base, detentIndex: 9 })).toBe(779);
    expect(leadSheetContentHeight({ ...base, detentIndex: -1 })).toBe(456);
  });
});
