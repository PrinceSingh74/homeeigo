import { spacing } from "./spacing";
import { radius } from "./tokens";

/** Services screen layout rhythm — 8pt grid. Radii come from the shared scale (tokens.ts). */
export const layout = {
  screenPadding: 20,
  sectionGap: 40,
  sectionGapTight: 30,
  headerToContent: 18,
  listGap: 16,
  listPeekRight: 32,
  cardRadius: radius.lg, // 20 — standard card
  cardRadiusSm: radius.sm, // 12 — compact controls
  cardRadiusLg: radius.xl, // 24 — feature / media cards
  cardRadiusXl: radius.xl, // 24 — hero cards / sheets
  iconRadius: radius.md, // 16
  chipRadius: radius.pill, // fully-rounded chips
  searchHeight: 56,
} as const;

export const horizontalListContent = {
  paddingLeft: layout.screenPadding,
  paddingRight: layout.listPeekRight,
  gap: layout.listGap,
} as const;

export { spacing };
