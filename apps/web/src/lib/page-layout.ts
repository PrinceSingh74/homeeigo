import { cn } from "@/lib/utils";

/** Max content width + horizontal padding (all breakpoints + safe area). */
export const pageMax = "mx-auto w-full max-w-content";
export const pagePadX =
  "px-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:px-6 lg:px-8";

export const pageSection = cn(pageMax, pagePadX);
export const pageSectionGap = "mt-16 sm:mt-20 lg:mt-24";
export const pageMainBottom =
  "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0";

/** Inner app pages (bookings, etc.) — same padding + bottom nav clearance */
export const pageShellMain = cn(
  pageMax,
  pagePadX,
  "relative min-h-screen pt-6 sm:pt-8",
  "pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] lg:pb-20",
);

/** Page subtitle / lead paragraph */
export const pageLead =
  "mt-2 max-w-md text-base leading-relaxed text-muted sm:text-lg";

/** Section headings — fluid scale across viewports. */
export const sectionTitle =
  "font-display type-title font-bold tracking-tight text-content";

/** Section header row (title + action) — editorial, no box */
export const sectionHeaderRow =
  "mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-10";

/** Section / hero lead copy */
export const sectionSubtitle =
  "text-base leading-relaxed text-muted sm:text-lg";

/** Marketing hero headline */
export const heroTitle =
  "font-display type-display font-bold tracking-tight text-content";

/** Inline section action link */
export const sectionAction =
  "rounded-lg text-sm font-semibold text-brand outline-none transition-colors hover:text-brand/80 focus-visible:ring-2 focus-visible:ring-brand/60 sm:text-base";

/** Dashboard / page H1 */
export const pageTitle =
  "font-display text-[clamp(1.75rem,4.5vw,2rem)] font-bold tracking-tight text-content sm:text-[2rem]";
