import { cn } from "@/lib/utils";
import { pageMax, pagePadX } from "@/lib/page-layout";

export const walletBleedX = "w-full min-w-0 max-w-full overflow-x-clip";

export const walletPageRoot = cn(
  "wallet-page relative flex w-full max-w-[100vw] flex-col overflow-hidden bg-canvas",
  "min-h-[100dvh] max-h-[100dvh]",
  "lg:min-h-[calc(100dvh-var(--site-nav-offset,4rem))] lg:max-h-[calc(100dvh-var(--site-nav-offset,4rem))]",
);

export const walletShell = cn("flex min-h-0 min-w-0 flex-1 flex-col");

export const walletMain = cn(
  walletBleedX,
  "min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-contain",
  "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-6",
);

export const walletContainer = cn(pageMax, "mx-auto w-full min-w-0");

export const walletPageHeader = cn(
  pagePadX,
  "border-b border-white/55 bg-white/50 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]",
  "px-3 py-4",
  "sm:px-6 sm:py-6 lg:px-8 lg:pt-8",
);

export const walletContent = cn(
  pagePadX,
  "space-y-5 py-5 sm:space-y-8 sm:py-8 lg:px-8",
);

export const walletPageTitle =
  "font-display text-[clamp(1.375rem,4.5vw,2rem)] font-bold tracking-tight text-content";

export const walletBalanceGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-3",
  "sm:grid-cols-2 sm:gap-4",
  "lg:grid-cols-12",
);

export const walletBalanceHero = cn(
  "relative min-h-0 overflow-hidden rounded-2xl sm:rounded-3xl",
  "p-4 sm:p-6 lg:col-span-6 lg:p-8",
  "sm:col-span-2",
);

export const walletSummaryCard = "lg:col-span-2";

export const walletQuickActionsRail = cn(
  walletBleedX,
  "flex gap-2.5 overflow-x-auto pb-1 scrollbar-none snap-x snap-mandatory",
  "sm:gap-4 sm:pb-2",
);

export const walletQuickActionItem = cn(
  "wallet-quick-action flex w-[min(28vw,108px)] shrink-0 snap-start flex-col items-center justify-center gap-2 p-3.5",
  "min-[400px]:w-[min(24vw,120px)]",
  "sm:w-[min(18vw,140px)] sm:gap-3 sm:p-5",
  "md:min-w-[120px] md:flex-1 md:shrink md:snap-normal",
);

export const walletMainGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-5 sm:gap-6",
  "xl:grid-cols-[minmax(0,1fr)_minmax(260px,380px)] xl:gap-8",
);

export const walletTabsRow = cn(
  "flex gap-1 overflow-x-auto border-b border-line/80 scrollbar-none snap-x snap-mandatory",
  "px-1 sm:gap-2 sm:px-2",
);

export const walletTabBtn = cn(
  "relative shrink-0 snap-start whitespace-nowrap border-b-[3px] px-3 py-3",
  "text-[12px] font-medium sm:px-4 sm:py-3.5 sm:text-sm",
);

export const walletTabPanel = "p-3 sm:p-5 lg:p-6";

export const walletPanelShell = cn(
  "wallet-panel w-full min-w-0 overflow-hidden rounded-[22px] glass-card ring-aurora sm:rounded-[26px]",
);

export const walletPanelPad = "p-4 sm:p-6";
