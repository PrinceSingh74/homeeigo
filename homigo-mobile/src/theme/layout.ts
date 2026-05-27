import { spacing } from "./spacing";

/** Services screen layout rhythm — 8pt grid */
export const layout = {
  screenPadding: 20,
  sectionGap: 36,
  sectionGapTight: 28,
  headerToContent: 16,
  listGap: 14,
  listPeekRight: 32,
  cardRadius: 18,
  cardRadiusSm: 14,
  cardRadiusLg: 22,
  cardRadiusXl: 24,
  iconRadius: 20,
  chipRadius: 22,
  searchHeight: 54,
} as const;

export const horizontalListContent = {
  paddingLeft: layout.screenPadding,
  paddingRight: layout.listPeekRight,
  gap: layout.listGap,
} as const;

export { spacing };
