"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Headphones } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
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
          style={{ height: 22 }}
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

export function FeatureBanner() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <PageSection>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1fr_minmax(0,20rem)]">
        {/* Main banner */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex min-h-[280px] flex-col justify-center overflow-hidden rounded-[24px] bg-darkviolet p-6 shadow-e5 ring-1 ring-white/10 sm:min-h-96 sm:rounded-[32px] sm:p-10 lg:rounded-[36px] lg:p-16"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/12 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-cyan/20 blur-3xl"
          />
          <p className="relative text-sm font-medium uppercase tracking-[0.18em] text-white/55">
            Home services at
          </p>
          <h2
            className="relative mt-3 font-display font-bold text-white"
            style={{ fontSize: "clamp(2rem, 8vw, 4.5rem)" }}
          >
            Light{" "}
            <span className="bg-gradient-to-r from-cyan to-white bg-clip-text text-transparent">
              Speed.
            </span>
          </h2>
          <p className="relative mt-4 max-w-md text-base text-white/75 sm:text-lg">
            Instant booking, real-time tracking, lightning-fast service at your
            doorstep.
          </p>

          <Link
            href={bookUrl()}
            className="relative mt-8 inline-flex h-14 w-fit items-center gap-2 rounded-2xl bg-white px-8 text-base font-semibold text-[#1E1B4B] shadow-e3 outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Book Now
            <ArrowRight size={18} />
          </Link>

          {/* Rider + speed trails */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-4 bottom-4 hidden items-center sm:flex"
          >
            <div className="relative">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute top-1/2 h-1 rounded-full bg-gradient-to-r from-cyan to-pink"
                  style={{ width: 40 + i * 16, right: 70, top: 14 + i * 12 }}
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
                alt="Delivery rider"
                sizes="(min-width: 1024px) 256px, 208px"
                wrapperClassName="h-52 w-44 lg:h-64 lg:w-52"
                animate={reduce ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="drop-shadow-2xl"
              />
            </div>
          </div>
        </motion.div>

        {/* Mini cards */}
        <div className="flex flex-col gap-6">
          {/* Support */}
          <motion.button
            type="button"
            onClick={() => openOverlay("support")}
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex min-h-44 w-full flex-col justify-between rounded-3xl bg-aurora p-6 text-left text-white shadow-glow-blue outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <div>
              <p className="text-lg font-bold">Need help?</p>
              <p className="text-sm text-white/85">24/7 support for bookings & payments</p>
            </div>
            <div className="flex items-center justify-between">
              <Waveform />
              <motion.span
                whileHover={{ scale: 1.1 }}
                className="grid size-14 place-items-center rounded-full border-2 border-white/70 bg-white/15"
              >
                <Headphones size={28} />
              </motion.span>
            </div>
          </motion.button>

          {/* Wallet */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
          <Link
            href="/wallet"
            className="relative flex min-h-44 w-full flex-col justify-between overflow-hidden rounded-3xl glass-card p-6 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/3 sheen"
            />
            <p className="relative text-sm font-bold text-muted">HOMIGO Wallet</p>
            <div>
              <p className="font-display text-3xl font-bold text-content">
                ₹2,450.00
              </p>
              <p className="text-sm text-muted">Wallet Balance</p>
            </div>
            <div className="flex justify-end">
              <MotionImage
                src="/wallet-3d.png"
                alt="Wallet"
                sizes="80px"
                wrapperClassName="size-20"
                animate={reduce ? undefined : { y: [0, -4, 0], rotate: [0, 5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="drop-shadow-xl"
              />
            </div>
          </Link>
          </motion.div>
        </div>
      </div>
    </PageSection>
  );
}
