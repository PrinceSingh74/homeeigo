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

/** Conversion sections (11, 12, 14, 15) — premium spacing & typography */
export const svcConversionSectionPad = "py-20 sm:py-24 lg:py-28";

export const svcConversionEyebrow =
  "mb-5 inline-flex items-center rounded-full border border-emerald-200/90 bg-emerald-50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-800";

export const svcConversionHeadline =
  "font-display text-[clamp(2rem,4.8vw,3rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#0F172A]";

export const svcConversionHeadlineDark =
  "font-display text-[clamp(2rem,4.8vw,3rem)] font-bold leading-[1.08] tracking-[-0.035em] text-white";

export const svcConversionSubhead =
  "mx-auto mt-5 max-w-2xl text-[17px] font-normal leading-[1.65] text-gray-700 sm:mt-6 sm:text-lg sm:leading-[1.7]";

export const svcConversionSubheadDark =
  "mx-auto mt-5 max-w-2xl text-[17px] font-normal leading-[1.65] text-slate-300 sm:mt-6 sm:text-lg sm:leading-[1.7]";

export const svcConversionCard =
  "overflow-hidden rounded-[20px] border border-gray-200/90 bg-white shadow-[0_4px_24px_-10px_rgb(15_23_42/0.1)] transition-[box-shadow,transform,border-color] duration-300 hover:border-emerald-200/80 hover:shadow-[0_20px_48px_-16px_rgb(27_94_79/0.18)]";

export const svcConversionCardDark =
  "overflow-hidden rounded-[20px] border border-slate-600/70 bg-slate-900/90 shadow-[0_8px_32px_-12px_rgb(0_0_0/0.45)] backdrop-blur-md transition-[box-shadow,border-color] duration-300 hover:border-emerald-500/45 hover:shadow-[0_0_40px_-10px_rgb(16_185_129/0.28)]";

export const svcConversionTrustBar =
  "rounded-[20px] border-2 border-emerald-100 bg-white px-6 py-7 shadow-[0_4px_24px_-12px_rgb(27_94_79/0.08)] sm:px-10 sm:py-8";

/** Unsplash 4K crop helper */
export function unsplash4k(
  photoId: string,
  w = 2400,
  extra = "auto=format&fit=crop",
): string {
  return `https://images.unsplash.com/${photoId}?w=${w}&q=95&${extra}`;
}
