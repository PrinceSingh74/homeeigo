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
  "font-display text-2xl font-bold tracking-tight text-content sm:text-3xl md:text-4xl lg:text-[2.75rem]";

/** Section header row (title + action) */
export const sectionHeaderRow =
  "mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/55 bg-white/45 px-4 py-3 shadow-[0_8px_24px_-14px_rgb(15_23_42/0.25)] backdrop-blur-xl sm:mb-10 sm:px-5 sm:py-3.5 dark:border-white/10 dark:bg-white/[0.03]";

/** Section / hero lead copy */
export const sectionSubtitle =
  "text-base leading-relaxed text-muted sm:text-lg";

/** Marketing hero headline */
export const heroTitle =
  "font-display font-bold leading-[1.08] tracking-tight text-content text-[clamp(2.25rem,6vw,4rem)]";

/** Inline section action link */
export const sectionAction =
  "rounded-md text-sm font-semibold text-primary outline-none transition-colors hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-primary/60 sm:text-base";

/** Dashboard / page H1 */
export const pageTitle =
  "font-display text-[clamp(1.75rem,4.5vw,2rem)] font-bold tracking-tight text-content sm:text-[2rem]";
