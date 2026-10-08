/**
 * How far a screen's scroll must move so a focused field AND the control under it (its Confirm
 * button) sit inside the visible area that remains above the keyboard and the docked footer.
 *
 * The OS brings the focused input itself into view; it knows nothing about the button under it, so
 * a field low on the page typed into fine while its "Confirm" stayed hidden (found on the Android
 * emulator 2026-10-08, the requirement note on the job page). Pure: measurements in, points out.
 *
 *   viewTop / viewBottom  — the field's edges in window coordinates;
 *   allowanceBelow        — room to keep clear under the field (the control's height plus its gap);
 *   visibleTop / visibleBottom — the scroll area's edges, the bottom one being whatever sits above
 *                           the content: the keyboard, or the docked footer above the keyboard.
 *
 * Returns 0 when everything already fits or a measurement is missing; otherwise the overlap, capped
 * so the field's own top is never pushed above the visible area (its label must stay readable).
 */
export function revealScrollDelta({
  viewTop,
  viewBottom,
  allowanceBelow,
  visibleTop,
  visibleBottom,
}: {
  viewTop: number | null | undefined;
  viewBottom: number | null | undefined;
  allowanceBelow: number;
  visibleTop: number | null | undefined;
  visibleBottom: number | null | undefined;
}): number {
  const nums = [viewTop, viewBottom, allowanceBelow, visibleTop, visibleBottom];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return 0;
  const overlap = (viewBottom as number) + allowanceBelow - (visibleBottom as number);
  if (overlap <= 0) return 0;
  const room = (viewTop as number) - (visibleTop as number);
  if (room <= 0) return 0;
  return Math.round(Math.min(overlap, room));
}
