import { Platform } from "react-native";

export const COMPOSER_BAR_HEIGHT = 88;
export const COMPOSER_DOCK_EXTRA = 14;

/** Gap between composer and bottom tab menu (not flush with nav) */
export const TAB_MENU_GAP = 14;

/** Extra breathing room above keyboard when typing */
export const KEYBOARD_ABOVE_GAP = Platform.OS === "ios" ? 10 : 12;

/** Padding inside dock when keyboard is open — lifts bar above keyboard */
export function composerKeyboardPadding(keyboardHeight: number): number {
  if (keyboardHeight <= 0) return 0;
  return keyboardHeight + KEYBOARD_ABOVE_GAP;
}

/** Fixed footer height (scroll area ends above this — no overlap) */
export function composerFooterHeight(keyboardHeight: number): number {
  return (
    COMPOSER_DOCK_EXTRA +
    COMPOSER_BAR_HEIGHT +
    TAB_MENU_GAP +
    composerKeyboardPadding(keyboardHeight)
  );
}
