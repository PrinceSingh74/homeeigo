import { cn } from "@/lib/cn";

type StaticSkeletonProps = {
  className?: string;
  /**
   * Premium gradient sweep (uses the partnerShimmer keyframe). Opt-in — only for
   * transient route/loading skeletons; animates background-position (cheap).
   */
  shimmer?: boolean;
  "aria-hidden"?: boolean;
};

/** Placeholder block for the partner console. Flat by default; `shimmer` sweeps. */
export function StaticSkeleton({ className, shimmer = false, "aria-hidden": ariaHidden = true }: StaticSkeletonProps) {
  if (shimmer) {
    return (
      <div
        className={cn("bg-white/[0.04]", className)}
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(37,99,235,0.14) 50%, rgba(255,255,255,0.02) 100%)",
          backgroundSize: "200% 100%",
          animation: "var(--animate-shimmer)",
        }}
        aria-hidden={ariaHidden}
      />
    );
  }
  return <div className={cn("bg-white/[0.04]", className)} aria-hidden={ariaHidden} />;
}
