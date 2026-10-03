"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Headphones } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import { useWalletBalanceQuery } from "@/hooks/use-core-data";
import { bookUrl } from "@/lib/booking-url";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { PageSection } from "@/components/layout/PageSection";
import { MotionImage } from "@/components/ui/MotionImage";

function Waveform() {
  const reduce = useReducedMotion();
  const bars = [0.4, 0.8, 0.55, 1, 0.65, 0.45];
  return (
    <div className="flex items-end gap-1" aria-hidden>
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className="w-1 rounded-full bg-white/80"
          style={{ height: 18 }}
          animate={reduce ? undefined : { scaleY: [h, 1, h * 0.6, h] }}
          transition={{
            duration: 0.9,
            delay: i * 0.08,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/**
 * "Light Speed" utility band — a secondary section: compact banner + two
 * utility tiles, deliberately lighter than the service-discovery wall above.
 */
export function FeatureBanner() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const authenticated = useAuthStore((s) => s.status === "authenticated");
  const { data: walletData, isLoading: walletLoading } = useWalletBalanceQuery();
  const balance = walletData?.balance ?? 0;

  return (
    <PageSection>
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
        {/* Main banner */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex min-h-60 flex-col justify-center overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#065f46_0%,#0f766e_55%,#134e4a_100%)] p-6 shadow-e4 ring-1 ring-white/10 sm:min-h-72 sm:p-8 lg:p-10"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/10 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-emerald-300/20 blur-3xl"
          />
          <p className="relative text-sm font-semibold text-white/80">Home services at</p>
          <h2 className="relative mt-2 font-display type-title font-bold tracking-tight text-white">
            Light{" "}
            <span className="bg-gradient-to-r from-emerald-300 to-white bg-clip-text text-transparent">
              Speed.
            </span>
          </h2>
          <p className="relative mt-3 max-w-md text-base text-white/80">
            Instant booking, real-time tracking, lightning-fast service at your
            doorstep.
          </p>

          <div className="relative mt-6 w-fit">
            <ButtonLink href={bookUrl()} variant="inverse" size="lg" className="group">
              Book Now
              <ArrowRight
                size={18}
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              />
            </ButtonLink>
          </div>

          {/* Rider + speed trails */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-2 bottom-2 hidden items-center sm:flex"
          >
            <div className="relative">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute top-1/2 h-1 rounded-full bg-gradient-to-r from-emerald-300 to-teal-400"
                  style={{ width: 36 + i * 14, right: 60, top: 12 + i * 12 }}
                  animate={
                    reduce ? undefined : { opacity: [0, 0.8, 0], x: [10, -16, 10] }
                  }
                  transition={{
                    duration: 1.6,
                    delay: i * 0.18,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              ))}
              <MotionImage
                src="/rider.webp"
                alt=""
                sizes="(min-width: 1024px) 208px, 160px"
                wrapperClassName="h-40 w-36 lg:h-52 lg:w-44"
                animate={reduce ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="drop-shadow-2xl"
              />
            </div>
          </div>
        </motion.div>

        {/* Utility tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {/* Support */}
          <motion.button
            type="button"
            onClick={() => openOverlay("support")}
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="card-sheen flex min-h-36 w-full flex-col justify-between rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] p-5 text-left text-white shadow-[0_14px_36px_-14px_rgb(16_185_129/0.45)] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <div>
              <p className="text-base font-bold">Need help?</p>
              <p className="mt-0.5 text-sm text-white/80">24/7 support for bookings &amp; payments</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Waveform />
              <span className="grid size-11 place-items-center rounded-full border-2 border-white/70 bg-white/15">
                <Headphones size={22} aria-hidden />
              </span>
            </div>
          </motion.button>

          {/* Wallet — live balance for signed-in customers, never a placeholder figure */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Link
              href="/wallet"
              className="relative flex min-h-36 w-full flex-col justify-between overflow-hidden rounded-2xl glass-card card-sheen p-5 text-left outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1/3 sheen"
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-muted">HOMEEIGO Wallet</p>
                  {authenticated ? (
                    <>
                      <p className="mt-1 font-display text-2xl font-bold text-content">
                        {walletLoading
                          ? "—"
                          : `₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                      </p>
                      <p className="text-sm text-muted">Wallet balance</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 font-display text-lg font-bold leading-tight text-content">
                        Instant refunds &amp; cashback
                      </p>
                      <p className="mt-0.5 text-sm text-muted">Sign in to see your balance</p>
                    </>
                  )}
                </div>
                <MotionImage
                  src="/wallet-3d.png"
                  alt=""
                  sizes="56px"
                  wrapperClassName="size-14 shrink-0"
                  animate={reduce ? undefined : { y: [0, -4, 0], rotate: [0, 5, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="drop-shadow-xl"
                />
              </div>
              <span className="relative mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                Open wallet
                <ArrowRight size={14} aria-hidden />
              </span>
            </Link>
          </motion.div>
        </div>
      </div>
    </PageSection>
  );
}
