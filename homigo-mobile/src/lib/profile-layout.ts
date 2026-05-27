export const PROFILE_PAD = 16;
export const PROFILE_SECTION_GAP = 20;
export const PROFILE_TAB_SPACER = 108;
export const PROFILE_CARD_RADIUS = 20;
export const PROFILE_INNER_RADIUS = 14;

export function profileStatTileWidth(screenWidth: number): number {
  const gap = 12;
  const inner = screenWidth - PROFILE_PAD * 2;
  return Math.floor((inner - gap) / 2);
}

export function profileInsightCardWidth(screenWidth: number): number {
  return Math.min(280, screenWidth * 0.72);
}

export function profileAddressCardWidth(screenWidth: number): number {
  return Math.min(200, screenWidth * 0.52);
}
