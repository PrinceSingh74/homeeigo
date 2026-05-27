import { cn } from "@/lib/utils";

/** 4K-ready image quality for Next/Image on services page */
export const SERVICES_IMAGE_QUALITY = 100;

/** Spec: fluid page padding, 1440px max, 60–80px section gaps */
export const servicesShell = "mx-auto w-full max-w-[1440px]";
export const servicesPadX = "px-[var(--svc-page-pad)]";
export const servicesSectionMb = "svc-section";

export function servicesSection(className?: string) {
  return cn(servicesShell, servicesPadX, servicesSectionMb, className);
}

export const servicesPageRoot = "services-page";

export const servicesHeroOuter = cn(
  servicesShell,
  servicesSectionMb,
  servicesPadX,
);

/** Inner padding inside hero shell (all breakpoints) */
export const svcHeroInner =
  "px-4 py-8 sm:px-6 sm:py-10 md:px-8 md:py-12 lg:px-10 lg:py-14 xl:py-[60px]";

export const svcCardPremium = "svc-card-premium glass-card depth-3d";
export const svcCatCard = "svc-cat-card svc-card-premium";
export const svcTrendCard = "svc-trend-card svc-card-premium";

/** Fluid section headings */
export const svcSectionTitle =
  "font-display text-[clamp(1.375rem,4.2vw,1.75rem)] font-bold leading-tight tracking-[-0.02em] text-content";

export const svcHeroTitle =
  "font-display text-[clamp(1.625rem,5.5vw,3.25rem)] font-bold leading-[1.12] tracking-[-0.03em] text-[#0F172A] dark:text-content xl:text-[52px]";

/** Horizontal category rail */
export const svcCatScroll =
  "svc-cat-scroll -mx-[var(--svc-page-pad)] flex gap-3 overflow-x-auto px-[var(--svc-page-pad)] pb-2 scrollbar-none snap-x snap-mandatory sm:gap-4";

export const svcCatCardSize =
  "svc-cat-card-size flex h-[168px] w-[min(42vw,152px)] min-w-[min(42vw,152px)] flex-col sm:h-[180px] sm:w-[148px] sm:min-w-[148px]";

/** Two-column section layouts (categories, AI, trending) */
export const svcSplitMain = "min-w-0";
export const svcSplitAside =
  "min-w-0 w-full lg:sticky lg:top-[calc(4rem+1.5rem)] lg:self-start";

/** Unsplash 4K crop helper */
export function unsplash4k(
  photoId: string,
  w = 2400,
  extra = "auto=format&fit=crop",
): string {
  return `https://images.unsplash.com/${photoId}?w=${w}&q=95&${extra}`;
}
