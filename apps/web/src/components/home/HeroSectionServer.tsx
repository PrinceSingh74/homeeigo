import Image from "next/image";
import { Sparkles, ShieldCheck, Star } from "lucide-react";
import { HeroCtaButtons } from "@/components/home/HeroCtaButtons";
import { heroTitle, pageMax, pagePadX, sectionSubtitle } from "@/lib/page-layout";
import type { StatsOverview } from "@/services/core/api";
import { cn } from "@/lib/utils";
import Link from "next/link";

const PARTICLES = [
  { x: "12%", y: "22%", s: 6 },
  { x: "78%", y: "16%", s: 4 },
  { x: "64%", y: "70%", s: 8 },
  { x: "30%", y: "82%", s: 5 },
];

export function HeroSectionServer({ stats }: { stats: StatsOverview | null }) {
  const nf = (n: number) => n.toLocaleString("en-IN");

  return (
    <section
      className={cn(
        pagePadX,
        "relative flex min-h-[min(85vh,900px)] items-center overflow-hidden py-12 sm:py-16 lg:min-h-[90vh] lg:py-20",
      )}
    >
      {/* EXACT Services-page hero canvas (.svc-hero-premium):
          linear-gradient(135deg,#ffffff 0%,#f0fdf4 35%,#ffffff 100%) + emerald/teal orbs.
          Dark-safe: falls back to the app canvas in dark mode. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_35%,#ffffff_100%)] dark:hidden" />
        <div className="absolute inset-0 hidden bg-canvas dark:block" />
        <div className="absolute inset-0 hero-grid opacity-40" />
        <div className="absolute right-0 top-0 size-96 rounded-full bg-emerald-100/30 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute bottom-0 left-0 size-96 rounded-full bg-teal-100/20 blur-3xl dark:bg-teal-500/10" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-canvas" />
      </div>

      <div
        className={cn(
          pageMax,
          "grid w-full grid-cols-1 items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12",
        )}
      >
        <div className="w-full min-w-0 animate-[fadeInUp_0.5s_ease-out] lg:max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-surface/70 px-4 py-1.5 text-xs font-semibold tracking-wide text-emerald-700 shadow-e1 backdrop-blur-md dark:text-emerald-300">
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <Sparkles size={14} />
            AI-Powered Home Services
          </span>

          <h1 className={cn(heroTitle, "mt-5")}>
            The Future of <br />
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-emerald-500 via-emerald-500 to-teal-500 bg-clip-text text-transparent">
                Home Services.
              </span>
              <span
                aria-hidden
                className="absolute -bottom-1.5 left-0 h-[3px] w-2/3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 opacity-80"
              />
            </span>
          </h1>

          <p className={cn(sectionSubtitle, "mt-6 w-full max-w-md")}>
            Smart. Fast. Reliable. Book verified professionals in under 60
            seconds with real-time tracking and AI-matched experts.
          </p>

          <HeroCtaButtons />

          {/* Trust indicators — premium glass chips */}
          <div className="mt-10 flex flex-wrap items-center gap-2.5 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 font-medium text-content shadow-e1 backdrop-blur-md">
              <ShieldCheck size={16} className="text-success" />
              Verified &amp; background-checked
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 font-medium text-content shadow-e1 backdrop-blur-md">
              <Star size={16} className="fill-gold text-gold" />
              {stats?.averageRating != null
                ? `${stats.averageRating} average rating`
                : stats
                  ? `${nf(stats.activeProviders)} verified pros`
                  : "Top-rated pros"}
            </span>
            {stats && stats.completedBookings > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-line/60 bg-surface/70 px-3.5 py-2 font-medium text-content shadow-e1 backdrop-blur-md">
                <Sparkles size={16} className="text-emerald-600" />
                {nf(stats.completedBookings)} jobs completed
              </span>
            ) : null}
          </div>
        </div>

        {/* ---- Mobile / tablet hero visual: professional portrait + villa inset ---- */}
        <div className="relative mx-auto w-full max-w-xs animate-[fadeInUp_0.6s_ease-out] pb-4 sm:max-w-sm lg:hidden">
          <div
            aria-hidden
            className="absolute inset-x-6 -bottom-1 h-16 rounded-[50%] bg-emerald-500/20 blur-2xl"
          />
          {/* Premium framed portrait */}
          <div className="relative rounded-[1.9rem] bg-gradient-to-b from-white/50 via-white/12 to-white/5 p-1 shadow-[0_30px_70px_-26px_rgb(16_185_129/0.45)] ring-1 ring-white/25 backdrop-blur">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[1.6rem]">
              <Image
                src="/hero-professional.png"
                alt="Verified HOMEEIGO home-service professional"
                fill
                sizes="(max-width: 1023px) 90vw, 0px"
                priority
                className="object-cover object-top"
              />
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-slate-950/10" />
            </div>
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/50 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-md">
              <ShieldCheck size={14} className="text-emerald-300" /> Verified Pro
            </span>
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/50 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/25 backdrop-blur-md">
              <Star size={13} className="fill-gold text-gold" /> 4.9 rating
            </span>
            {/* Villa inset — keeps the existing smart-home image */}
            <div className="absolute -right-3 bottom-8 w-24 rounded-xl bg-surface/85 p-1 shadow-e2 ring-1 ring-line/60 backdrop-blur-md">
              <Image
                src="/hero-villa.webp"
                alt="HOMEEIGO smart home"
                width={192}
                height={128}
                className="h-auto w-full rounded-lg object-contain"
              />
              <p className="px-1 pb-0.5 pt-1 text-center text-[9px] font-semibold text-muted">Smart-home ready</p>
            </div>
          </div>
        </div>

        {/* ---- Desktop hero visual: portrait hero + orbit + floating glass + villa ---- */}
        <div className="relative hidden min-h-[30rem] w-full animate-[fadeInUp_0.7s_ease-out] lg:block lg:min-h-[var(--homigo-hero-h)] xl:min-h-[var(--homigo-hero-h-xl)]">
          <div className="absolute inset-0 grid place-items-center">
            {/* Slow orbit rings — pure border, GPU rotate */}
            <div
              aria-hidden
              className="absolute size-[34rem] rounded-full border-2 border-dashed border-emerald-500/25 animate-[spin_40s_linear_infinite] xl:size-[42rem]"
            />
            <div
              aria-hidden
              className="absolute size-[26rem] rounded-full border border-teal-400/20 animate-[spin_28s_linear_infinite_reverse] xl:size-[32rem]"
            />
            <div className="relative w-full max-w-md animate-[float_6s_ease-in-out_infinite] xl:max-w-lg">
              {/* Grounding glow beneath the portrait */}
              <div
                aria-hidden
                className="absolute inset-x-14 -bottom-6 h-24 rounded-[50%] bg-emerald-500/25 blur-3xl"
              />
              {/* Premium framed professional portrait */}
              <div className="relative rounded-[2.2rem] bg-gradient-to-b from-white/55 via-white/12 to-white/5 p-1.5 shadow-[0_50px_110px_-34px_rgb(16_185_129/0.45)] ring-1 ring-white/25 backdrop-blur">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[1.9rem]">
                  <Image
                    src="/hero-professional.png"
                    alt="Verified HOMEEIGO home-service professional"
                    fill
                    sizes="(min-width: 1280px) 512px, (min-width: 1024px) 420px, 0px"
                    priority
                    className="object-cover object-top"
                  />
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-slate-950/10" />
                </div>
              </div>

              {/* Verified-pro glass chip — top-left */}
              <div className="absolute -left-6 top-10 rounded-2xl glass-card glass-reflect card-sheen px-4 py-3">
                <p className="relative z-10 inline-flex items-center gap-1.5 font-display text-sm font-bold text-content">
                  <ShieldCheck size={16} className="text-success" /> Verified Pro
                </p>
                <p className="relative z-10 text-[11px] font-medium text-muted">Background-checked</p>
              </div>

              {/* Arriving glass chip — top-right */}
              <Link
                href="#tracking"
                className="absolute -right-6 top-16 rounded-2xl glass-card glass-reflect card-sheen px-4 py-3 text-left transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.03]"
              >
                <p className="relative z-10 text-[11px] font-medium text-muted">Arriving in</p>
                <p className="relative z-10 font-display text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">12 min</p>
              </Link>

              {/* Live-tracking glass chip — bottom-left */}
              <Link
                href="#tracking"
                className="absolute -bottom-3 -left-4 rounded-2xl glass-card glass-reflect card-sheen px-4 py-3 text-left transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.03]"
              >
                <p className="text-[11px] font-medium text-muted">Live tracking</p>
                <p className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-success">
                  <span className="relative flex size-2" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
                  On the way
                </p>
              </Link>

              {/* Villa inset glass card — bottom-right (keeps existing smart-home image) */}
              <div className="absolute -right-8 bottom-6 w-36 rounded-2xl glass-card glass-reflect card-sheen p-2 xl:w-44">
                <Image
                  src="/hero-villa.webp"
                  alt="HOMEEIGO AI-connected smart home"
                  width={352}
                  height={235}
                  sizes="(min-width: 1280px) 176px, 144px"
                  className="h-auto w-full rounded-xl object-contain"
                />
                <p className="relative z-10 px-1 pb-0.5 pt-1.5 text-center text-[11px] font-semibold text-muted">
                  Smart-home ready
                </p>
              </div>
            </div>
          </div>
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-aurora opacity-40 animate-[float_4s_ease-in-out_infinite]"
              style={{ left: p.x, top: p.y, width: p.s, height: p.s, animationDelay: `${i * 0.4}s` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
