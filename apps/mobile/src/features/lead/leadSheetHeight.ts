/** Compact first; the grabber grows the same sheet to the larger detent. */
export const LEAD_SHEET_DETENTS = [0.55, 0.92] as const;

/**
 * Android lays the form sheet's React content out at the largest detent even
 * while the sheet rests at a smaller one, so the composer would sit below the
 * screen. Size the content to the detent the sheet is actually showing.
 */
export function leadSheetContentHeight(input: {
  readonly detentIndex: number;
  readonly detents: ReadonlyArray<number>;
  readonly bottomInset: number;
  readonly windowHeight: number;
  /** The measured container is the largest detent's content height. */
  readonly containerHeight: number | null;
}): number {
  const largest = input.detents[input.detents.length - 1] ?? 1;
  const index = Math.max(0, Math.min(input.detentIndex, input.detents.length - 1));
  const fraction = input.detents[index] ?? largest;
  // The native container subtracts the bottom inset from the largest detent.
  const availableSpace =
    input.containerHeight === null
      ? Math.max(0, input.windowHeight)
      : Math.max(0, (input.containerHeight + input.bottomInset) / largest);
  return Math.max(0, Math.round(fraction * availableSpace) - input.bottomInset);
}
