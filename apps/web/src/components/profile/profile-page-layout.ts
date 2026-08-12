import { cn } from "@/lib/utils";
import { pageMax, pagePadX } from "@/lib/page-layout";

export const profileBleedX = "w-full min-w-0 max-w-full overflow-x-clip";

export const profilePageRoot = cn(
  "profile-page relative flex w-full max-w-[100vw] flex-col",
  "bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_35%,#ffffff_100%)] dark:bg-canvas",
  "min-h-[100dvh]",
  "lg:min-h-[calc(100dvh-var(--site-nav-offset,4rem))]",
);

export const profileShell = cn("flex min-h-0 min-w-0 flex-1 flex-col");

export const profileMain = cn(
  profileBleedX,
  "min-h-0 min-w-0 flex-1 overflow-x-clip",
  "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8",
);

export const profileContainer = cn(pageMax, "mx-auto w-full min-w-0");

export const profilePageHeader = cn(
  pagePadX,
  "border-b border-white/55 bg-white/50 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]",
  "px-3 py-4",
  "sm:px-6 sm:py-6 lg:px-8 lg:pt-8",
);

export const profilePageTitle =
  "font-display text-[clamp(1.375rem,4.5vw,2rem)] font-bold tracking-tight text-content";

export const profileContent = cn(
  pagePadX,
  "space-y-4 py-4 sm:space-y-6 sm:py-6 lg:space-y-8 lg:px-8 lg:py-8",
);

export const profilePanelPad = "p-4 sm:p-5 lg:p-6";

/** Premium glass card — keeps wallet-panel for shared profile CSS */
export const profilePanelShell = cn(
  "profile-panel wallet-panel w-full min-w-0 overflow-hidden rounded-[22px] glass-card ring-aurora sm:rounded-[26px]",
);

export const profileHeroShell = cn(
  "profile-panel relative w-full min-w-0 overflow-hidden rounded-[22px] sm:rounded-[26px]",
  "bg-gradient-to-br from-luxe to-surface shadow-[0_8px_24px_rgb(0_0_0/0.06)] dark:from-charcoal/80 dark:to-ink",
  "ring-1 ring-line/80",
);

export const profileTwoColGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-6",
  "lg:grid-cols-2",
);

export const profileQuadGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-4",
  "min-[480px]:grid-cols-2",
  "xl:gap-6",
  "2xl:grid-cols-4",
);

export const profileStatsGrid = cn(
  "grid w-full min-w-0 grid-cols-1 gap-3",
  "min-[400px]:grid-cols-2",
  "xl:grid-cols-4 xl:gap-4",
);

export const profileStatsScroll = cn(
  profileBleedX,
  "-mx-1 flex gap-4 overflow-x-auto pb-1 scrollbar-none snap-x snap-mandatory sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-6 sm:overflow-visible sm:pb-0 lg:gap-8",
);

export const profilePremiumFeaturesRail = cn(
  profileBleedX,
  "flex gap-3 overflow-x-auto pb-1 scrollbar-none snap-x sm:flex-wrap sm:gap-4 sm:overflow-visible sm:pb-0 md:gap-6",
);

/** Clickable rows/cards — light hover uses luxe; dark keeps contrast with content text */
export const profileInteractiveSurface = cn(
  "border border-line bg-canvas transition hover:border-emerald-500",
  "hover:bg-luxe hover:shadow-[0_4px_12px_rgb(16_185_129/0.08)]",
  "dark:bg-charcoal/40 dark:hover:bg-emerald-600/12 dark:hover:shadow-[0_4px_16px_rgb(16_185_129/0.18)]",
);
