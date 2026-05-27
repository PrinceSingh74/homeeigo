import { cn } from "@/lib/utils";
import { pageMax, pagePadX, pageTitle } from "@/lib/page-layout";

export const bookPageRoot = "book-page";

export const bookMain = cn(
  pageMax,
  pagePadX,
  "pt-4 sm:pt-6",
  "pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))]",
  "lg:pb-20",
);

export { pageTitle as bookPageTitle };

export const bookSectionCard = cn(
  "relative overflow-hidden rounded-[20px] glass-card",
  "p-4 sm:rounded-[24px] sm:p-6 lg:rounded-[28px] lg:p-9",
);

export const bookSectionTitle =
  "font-display text-[clamp(1.25rem,4vw,1.875rem)] font-bold tracking-tight text-content";

export const bookHeroTitle =
  "font-display font-bold tracking-tight text-white";

export const bookServiceRail = cn(
  "-mx-[max(1rem,env(safe-area-inset-left,0px))] flex gap-3 overflow-x-auto px-[max(1rem,env(safe-area-inset-left,0px))] pb-2 scrollbar-none snap-x snap-mandatory",
  "sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 md:gap-5 lg:grid-cols-6",
);

export const bookServiceCard = cn(
  "book-service-card group relative flex shrink-0 snap-start flex-col items-center justify-center overflow-hidden text-center transition-shadow duration-300",
  "h-[11.5rem] w-[min(42vw,148px)] min-w-[min(42vw,148px)] rounded-[18px] p-3 gap-2",
  "sm:h-64 sm:w-auto sm:min-w-0 sm:shrink sm:snap-normal sm:rounded-[28px] sm:gap-4 sm:p-5",
);

export const bookSplitGrid =
  "mt-6 grid gap-6 sm:mt-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]";

export const bookPackageGrid =
  "grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 lg:gap-6";
