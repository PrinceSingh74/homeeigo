/** Wallet screen layout tokens — match Figma / spec */
export const WALLET_PAD = 16;
export const WALLET_HERO_H = 280;
export const WALLET_HERO_H_COMPACT = 260;
export const WALLET_SECTION_GAP = 24;
export const WALLET_TAB_SPACER = 100;

export function walletTileWidth(screenWidth: number): number {
  const inner = screenWidth - WALLET_PAD * 2;
  return Math.min(85, Math.max(65, inner * 0.19));
}

export function walletQuickSnap(screenWidth: number): number {
  return walletTileWidth(screenWidth) + 12;
}
