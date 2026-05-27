/** Responsive layout math for Services screen — base design width 390pt */

const BASE_CONTENT = 350;

export type ServicesLayoutMetrics = {
  screenW: number;
  screenH: number;
  scale: number;
  isCompact: boolean;
  isSmall: boolean;
  isLarge: boolean;
  pad: number;
  contentW: number;
  listGap: number;
  listPeek: number;
  listContent: {
    paddingLeft: number;
    paddingRight: number;
    gap: number;
  };
  sectionGap: number;
  sectionGapTight: number;
  trendingCardW: number;
  trendingSnap: number;
  trendingImageH: number;
  trendingListMinH: number;
  aiCardW: number;
  reviewCardW: number;
  reviewSnap: number;
  whyCardW: number;
  categoryW: number;
  categoryIcon: number;
  heroTitleSize: number;
  heroTitleLine: number;
  heroHouseW: number;
  searchHeight: number;
  headerLocationMaxW: number;
  expressTrackTravel: number;
  scrollBottom: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round(n: number) {
  return Math.round(n);
}

export function computeServicesLayout(
  screenW: number,
  screenH: number,
  safeBottom = 0,
): ServicesLayoutMetrics {
  const isCompact = screenW < 360;
  const isSmall = screenW < 375;
  const isLarge = screenW >= 414;

  const pad = isCompact ? 14 : isSmall ? 16 : 20;
  const contentW = screenW - pad * 2;
  const scale = clamp(contentW / BASE_CONTENT, 0.82, 1.1);

  const listGap = isCompact ? 12 : 14;
  const listPeek = round(pad * 1.55);

  const trendingCardW = round(clamp(contentW * 0.52, 168, isLarge ? 228 : 212));
  const aiCardW = round(clamp(contentW * 0.58, 188, isLarge ? 248 : 228));
  const reviewCardW = round(clamp(contentW * 0.9, 268, 320));
  const whyCardW = round(clamp(contentW * 0.64, 200, 268));
  const categoryW = round(clamp(92 * scale, 78, 100));
  const categoryIcon = round(clamp(78 * scale, 68, 84));

  const heroTitleSize = isCompact ? 26 : isSmall ? 28 : 30;
  const heroTitleLine = isCompact ? 32 : isSmall ? 34 : 36;
  const heroHouseW = isCompact
    ? round(clamp(screenW * 0.32, 108, 128))
    : round(clamp(screenW * 0.36, 128, 152));

  const expressTrackTravel = round(clamp(contentW * 0.38, 100, 168));

  return {
    screenW,
    screenH,
    scale,
    isCompact,
    isSmall,
    isLarge,
    pad,
    contentW,
    listGap,
    listPeek,
    listContent: {
      paddingLeft: pad,
      paddingRight: listPeek,
      gap: listGap,
    },
    sectionGap: round(clamp(36 * scale, 24, 40)),
    sectionGapTight: round(clamp(28 * scale, 20, 32)),
    trendingCardW,
    trendingSnap: trendingCardW + listGap,
    trendingImageH: round(clamp(128 * scale, 112, 140)),
    trendingListMinH: round(clamp(300 * scale, 268, 320)),
    aiCardW,
    reviewCardW,
    reviewSnap: reviewCardW + listGap,
    whyCardW,
    categoryW,
    categoryIcon,
    heroTitleSize,
    heroTitleLine,
    heroHouseW,
    searchHeight: round(clamp(54 * scale, 48, 56)),
    headerLocationMaxW: isCompact ? 88 : isSmall ? 104 : 128,
    expressTrackTravel,
    scrollBottom: round(92 + safeBottom),
  };
}
