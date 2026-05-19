"use client";

/**
 * Fixed, full-page ambient aurora mesh. Gives glass surfaces a premium,
 * colorful backdrop to blur against. Pure CSS animation (GPU-friendly),
 * respects prefers-reduced-motion via the global media query.
 */
export function AuroraBackground() {
  return (
    <div className="mesh-bg" aria-hidden>
      {/* base wash */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_0%,rgb(37_99_235/0.06),transparent_60%)]" />

      {/* aurora blobs */}
      <div className="absolute -left-40 -top-32 size-[36rem] rounded-full bg-aurora opacity-25 blur-[120px] animate-aurora dark:opacity-20" />
      <div className="absolute -right-48 top-1/4 size-[40rem] rounded-full bg-premium opacity-20 blur-[140px] animate-[aurora_24s_ease-in-out_infinite] dark:opacity-18" />
      <div className="absolute bottom-0 left-1/3 size-[34rem] rounded-full bg-[conic-gradient(from_140deg,#06b6d4,#7c3aed,#2563eb,#06b6d4)] opacity-15 blur-[130px] animate-[float_16s_ease-in-out_infinite] dark:opacity-15" />
      <div className="absolute right-1/4 top-2/3 size-[26rem] rounded-full bg-gold opacity-10 blur-[120px] animate-[aurora_30s_ease-in-out_infinite]" />

      {/* subtle grain/vignette for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_55%,rgb(15_23_42/0.05)_100%)] dark:bg-[radial-gradient(120%_90%_at_50%_50%,transparent_45%,rgb(0_0_0/0.35)_100%)]" />
    </div>
  );
}
