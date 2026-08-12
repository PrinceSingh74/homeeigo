import { cn } from "@/lib/utils";

export const aiBleedX = "w-full min-w-0 max-w-full overflow-x-clip";

/** Full viewport shell — natural scroll on mobile, locked app frame on desktop. */
export const aiPageRoot = cn(
  "ai-page relative flex w-full max-w-[100vw] flex-col",
  "min-h-[100dvh]",
  "max-lg:overflow-x-clip",
  "lg:min-h-[calc(100dvh-var(--site-nav-offset))] lg:max-h-[calc(100dvh-var(--site-nav-offset))] lg:overflow-hidden",
);

export const aiShell = cn(
  "ai-perspective-stage relative z-[1] flex min-w-0 flex-col",
  "max-lg:flex-none lg:min-h-0 lg:flex-1",
);

/** Mobile: fixed AI toolbar. Desktop: content stays below site Navbar. */
export const aiNavClearance = cn(
  "max-lg:scroll-pt-[var(--ai-nav-offset)] max-lg:pt-[var(--ai-nav-offset)]",
  "lg:scroll-pt-[var(--site-nav-offset)]",
);

export const aiMain = cn(
  aiBleedX,
  "min-w-0 overscroll-y-contain",
  aiNavClearance,
  "max-lg:overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-x-clip lg:overflow-y-auto",
  "max-lg:pb-[calc(4.5rem+4.75rem+env(safe-area-inset-bottom,0px))]",
  "sm:max-lg:pb-[calc(4.5rem+5.25rem+env(safe-area-inset-bottom,0px))]",
  "lg:pb-[5.5rem]",
);

export const aiContentWrap = cn(
  "ai-content-hd mx-auto w-full min-w-0 max-w-[1440px]",
  "px-3 sm:px-6 lg:px-8",
);

export const aiBodyGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-4 pb-6 pt-3",
  "sm:gap-6 sm:pb-8 sm:pt-4",
  "lg:gap-8 lg:pt-6",
  "xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] xl:items-start xl:gap-8",
);

export const aiRightRail = cn(
  "min-w-0 w-full",
  "xl:sticky xl:top-[calc(var(--site-nav-offset)+1.25rem)] xl:z-10",
  "xl:max-h-[calc(100dvh-var(--site-nav-offset)-5.5rem)] xl:overflow-y-auto xl:overflow-x-hidden xl:pb-4 xl:scrollbar-none",
);

export const aiGlassPanel = "ai-glass-panel";
export const aiSectionShell = "ai-section-shell ai-glass-panel";
export const aiCard3d = "ai-card-3d ai-glass-panel";

export const aiMobileLiveShell = cn(
  aiSectionShell,
  "w-full min-w-0 p-3.5 sm:p-5 xl:hidden",
);

export const aiRightShell = cn(
  "ai-right-rail-glass flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-[20px]",
  "border border-emerald-400/15 bg-[linear-gradient(150deg,rgb(8_38_29/0.7),rgb(3_17_12/0.85))] p-3.5 backdrop-blur-xl dark:border-emerald-400/15",
  "sm:gap-4 sm:rounded-[24px] sm:p-4",
  "lg:gap-5 lg:rounded-[28px] lg:p-5",
  aiGlassPanel,
);

export const aiRightBrandStrip = cn(
  "relative overflow-hidden rounded-xl bg-[linear-gradient(150deg,#0e4a38_0%,#062b20_55%,#04190f_100%)] p-3.5 text-white sm:rounded-2xl sm:p-4",
  "shadow-[0_16px_44px_-14px_rgb(4_60_45/0.75)]",
  "ring-1 ring-emerald-400/25",
);

export const aiRightBlock = cn(
  "ai-card-3d w-full min-w-0 rounded-xl border border-emerald-400/15 bg-emerald-950/30 p-3 sm:rounded-2xl sm:p-4 lg:p-[18px]",
);

export const aiRightBlockTitle =
  "font-display text-sm font-bold tracking-tight text-ink dark:text-slate-100";

export const aiRightBlockAction =
  "shrink-0 text-[11px] font-semibold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200";

export const aiRightInsightCard = cn(
  "ai-card-3d group flex w-full min-w-0 gap-3 rounded-xl border p-3",
);

export const aiRightPredictionsGrid = cn(
  "grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5 xl:grid-cols-2",
);

export const aiMainColumn = cn(
  "relative min-w-0 space-y-5 sm:space-y-6 lg:space-y-10",
);

export const aiSectionTitle = cn(
  "font-display text-lg font-bold tracking-tight text-ink dark:text-slate-100",
  "sm:text-xl lg:text-[1.35rem]",
);

export const aiSectionSubtitle = cn(
  "mt-1 max-w-lg text-xs leading-relaxed text-slate dark:text-slate-400",
  "sm:mt-1.5 sm:text-[13px] lg:text-sm",
);

export const aiSectionHeaderRow =
  "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4";

export const aiSectionHeaderMeta =
  "flex shrink-0 flex-col items-start gap-1.5 sm:items-end sm:gap-2";

export const aiSection = "relative z-[1] w-full min-w-0";

export const aiMiddleGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-6",
  "lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:gap-6",
);

export const aiSmartActionsGrid = cn(
  "grid w-full min-w-0 gap-2.5",
  "grid-cols-2",
  "min-[380px]:gap-3",
  "sm:grid-cols-3 sm:gap-3",
  "lg:grid-cols-6 lg:gap-4",
);

export const aiStatusShell = cn(
  aiSectionShell,
  "w-full min-w-0 p-3.5 sm:p-5 lg:p-6",
);

export const aiStatusSummaryGrid = cn(
  "mb-3 grid grid-cols-3 gap-1.5 sm:mb-5 sm:gap-3",
);

export const aiStatusSummaryCell = cn(
  "ai-card-3d flex min-w-0 flex-col gap-0.5 rounded-xl border border-emerald-400/15 bg-emerald-950/30 px-2 py-2 sm:rounded-2xl sm:px-4 sm:py-3",
);

export const aiStatusGrid = cn(
  "w-full min-w-0 gap-3 sm:gap-4",
  "max-[429px]:-mx-0.5 max-[429px]:flex max-[429px]:snap-x max-[429px]:snap-mandatory max-[429px]:overflow-x-auto max-[429px]:pb-2 max-[429px]:scrollbar-none",
  "min-[430px]:grid min-[430px]:auto-rows-fr",
  "min-[430px]:grid-cols-[repeat(auto-fill,minmax(11.75rem,1fr))]",
);

export const aiStatusCardWrap = cn(
  "h-full min-w-0",
  "max-[429px]:w-[11.75rem] max-[429px]:max-w-[11.75rem] max-[429px]:shrink-0 max-[429px]:snap-start",
);

export const aiStatusCard = cn(
  "ai-card-3d group relative flex h-full min-h-[168px] w-full flex-col overflow-hidden rounded-2xl",
  "border border-emerald-400/15 bg-emerald-950/30 p-3 sm:min-h-[184px] sm:rounded-[18px] sm:p-4",
);
