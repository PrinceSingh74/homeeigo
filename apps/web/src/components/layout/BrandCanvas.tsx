import { cn } from "@/lib/utils";

/** Home-page canvas: white → mint → white + emerald/teal orbs. */
export function BrandMesh({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("mesh-bg", className)}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_35%,#ffffff_100%)] dark:hidden" />
      <div className="absolute inset-0 hidden bg-canvas dark:block" />
      <div className="absolute right-[-6%] top-[-6%] size-[42rem] rounded-full bg-emerald-100/40 blur-3xl dark:bg-emerald-500/10" />
      <div className="absolute bottom-[-8%] left-[-8%] size-[38rem] rounded-full bg-teal-100/30 blur-3xl dark:bg-teal-500/10" />
    </div>
  );
}

/** Local hero wash — same colours as BrandMesh, scoped to a section. */
export function BrandHeroWash({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_35%,#ffffff_100%)] dark:hidden" />
      <div className="absolute inset-0 hidden bg-canvas dark:block" />
      <div className="absolute right-0 top-0 size-96 rounded-full bg-emerald-100/30 blur-3xl dark:bg-emerald-500/10" />
      <div className="absolute bottom-0 left-0 size-96 rounded-full bg-teal-100/20 blur-3xl dark:bg-teal-500/10" />
    </div>
  );
}

export const brandKicker =
  "inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-surface/70 px-4 py-1.5 text-xs font-semibold tracking-wide text-brand shadow-e1 backdrop-blur-md";

export const brandChip =
  "inline-flex items-center gap-2 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 text-sm font-medium text-content shadow-e1 backdrop-blur-md";

export const brandGradientText =
  "bg-gradient-to-r from-emerald-500 via-emerald-500 to-teal-500 bg-clip-text text-transparent";
