import { cn } from "@/lib/utils";

type StaticSkeletonProps = {
  className?: string;
  /**
   * Premium moving-gradient sweep. Opt-in — only for transient route/loading
   * skeletons (visible <500ms during a navigation), never for persistent page
   * elements. Animates `transform` only (GPU compositor, cheap).
   */
  shimmer?: boolean;
  "aria-hidden"?: boolean;
};

/** Placeholder block. Flat by default; `shimmer` adds the premium sweep. */
export function StaticSkeleton({ className, shimmer = false, "aria-hidden": ariaHidden = true }: StaticSkeletonProps) {
  if (shimmer) {
    return (
      <div className={cn("relative overflow-hidden bg-line/20", className)} aria-hidden={ariaHidden}>
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent animate-[shimmer_1.6s_ease-in-out_infinite] dark:via-white/[0.08]" />
      </div>
    );
  }
  return <div className={cn("bg-line/25", className)} aria-hidden={ariaHidden} />;
}

/** Gradient card placeholder for wallet balance hero. */
export function StaticShimmerCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-gradient-to-br from-violet/15 to-pink/15 ring-1 ring-line/40",
        className,
      )}
      aria-hidden
    />
  );
}
