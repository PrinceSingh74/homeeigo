"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bike, Bot, Wallet } from "lucide-react";

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

  return (
    <section className="mx-auto mt-16 max-w-content px-5 sm:px-8">
      <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
        {/* Main banner */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex min-h-70 flex-col justify-center overflow-hidden rounded-3xl bg-darkviolet p-8 shadow-e5 sm:p-10"
        >
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-white/55">
            Home services at
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold text-white sm:text-5xl">
            Light{" "}
            <span className="bg-gradient-to-r from-cyan to-white bg-clip-text text-transparent">
              Speed.
            </span>
          </h2>
          <p className="mt-3 max-w-sm text-sm text-white/75 sm:text-base">
            Instant booking, real-time tracking, lightning-fast service at your
            doorstep.
          </p>

          <motion.button
            type="button"
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-6 inline-flex h-12 w-fit items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-[#1E1B4B] shadow-e3 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Book Now
            <ArrowRight size={16} />
          </motion.button>

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
              <motion.div
                animate={reduce ? undefined : { y: [0, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="grid size-24 place-items-center rounded-2xl bg-white/10 text-white backdrop-blur-sm"
              >
                <Bike size={56} strokeWidth={1.5} />
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Mini cards */}
        <div className="flex flex-col gap-5">
          {/* AI Assistant */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex min-h-35 flex-col justify-between rounded-3xl bg-aurora p-4 text-white shadow-glow-blue"
          >
            <div>
              <p className="text-sm font-bold">Hi Arjun! 👋</p>
              <p className="text-xs text-white/85">How can I help you today?</p>
            </div>
            <div className="flex items-center justify-between">
              <Waveform />
              <motion.span
                whileHover={{ scale: 1.1 }}
                animate={reduce ? undefined : { rotate: [0, 360] }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                className="grid size-11 place-items-center rounded-full border-2 border-white/70 bg-white/15"
              >
                <Bot size={22} />
              </motion.span>
            </div>
          </motion.div>

          {/* Wallet */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex min-h-35 flex-col justify-between rounded-3xl border border-line bg-surface p-4 shadow-e3"
          >
            <p className="text-xs font-bold text-muted">HOMIGO Wallet</p>
            <div>
              <p className="font-display text-2xl font-bold text-content">
                ₹2,450.00
              </p>
              <p className="text-xs text-muted">Wallet Balance</p>
            </div>
            <div className="flex justify-end">
              <motion.span
                animate={reduce ? undefined : { y: [0, -4, 0], rotate: [0, 5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="grid size-12 place-items-center rounded-2xl bg-aurora text-white shadow-glow-blue"
              >
                <Wallet size={24} />
              </motion.span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
