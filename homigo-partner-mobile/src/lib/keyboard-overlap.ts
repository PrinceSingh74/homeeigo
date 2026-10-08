/**
 * How much bottom padding a view needs so the keyboard does not cover it, in points.
 *
 * `viewBottom` and `keyboardTop` are positions in the same window. The answer is 0 whenever the
 * keyboard is not shown — the position a "keyboard hid" event carries is not trusted, because on
 * Android it is the height of the visible frame rather than a position, and reading it as one left
 * sheets and docked footers floating above the bottom edge after the keyboard closed.
 */
export function keyboardOverlap({
  visible,
  viewBottom,
  keyboardTop,
}: {
  visible: boolean;
  viewBottom: number | null | undefined;
  keyboardTop: number | null | undefined;
}): number {
  if (!visible) return 0;
  if (typeof viewBottom !== "number" || typeof keyboardTop !== "number") return 0;
  if (!Number.isFinite(viewBottom) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, Math.round(viewBottom - keyboardTop));
}
