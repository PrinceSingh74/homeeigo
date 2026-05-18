"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Star,
  Users,
  Headphones,
  Cpu,
  RotateCcw,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

type Benefit = { icon: LucideIcon; l1: string; l2: string };

const BENEFITS: Benefit[] = [
  { icon: Star, l1: "Priority", l2: "Booking" },
  { icon: Users, l1: "Elite", l2: "Professionals" },
  { icon: Headphones, l1: "Premium", l2: "Support" },
  { icon: Cpu, l1: "AI", l2: "Optimization" },
  { icon: RotateCcw, l1: "Free", l2: "Revisits" },
];

export function PremiumSection() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[40px] bg-premium p-10 shadow-glow-violet sm:p-16"
      >
        {/* sheen */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />

        {/* big 3D crown */}
        <div className="pointer-events-none absolute right-10 top-1/2 hidden -translate-y-1/2 lg:block">
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 360] }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 grid place-items-center"
          >
            <span className="size-72 rounded-full border-2 border-dashed border-gold/50" />
          </motion.div>
          <motion.img
            src="/crown-3d.png"
            alt="Premium crown"
            animate={reduce ? undefined : { y: [0, -12, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="relative size-60 object-contain drop-shadow-2xl"
          />
        </div>

        <div className="relative lg:max-w-3xl">
          <h2 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">
            HOMIGO PREMIUM 👑
          </h2>
          <p className="mt-3 text-lg text-white/80">
            Unlock the elite home-care experience
          </p>

          <div className="mt-10 grid grid-cols-5 gap-4">
            {BENEFITS.map((b, i) => {
              const Icon = b.icon;
              return (
                <motion.div
                  key={b.l1}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.07 }}
                  className="flex flex-col items-center text-center"
                >
                  <span className="grid size-16 place-items-center rounded-2xl bg-white/15 text-white">
                    <Icon size={26} strokeWidth={2.2} />
                  </span>
                  <p className="mt-3 text-sm font-bold leading-tight text-white">
                    {b.l1}
                    <br />
                    <span className="font-medium text-white/85">{b.l2}</span>
                  </p>
                </motion.div>
              );
            })}
          </div>

          <motion.button
            type="button"
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-10 inline-flex h-14 items-center gap-2 rounded-2xl bg-white px-9 text-base font-bold text-violet shadow-e3 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Upgrade Now
            <ArrowRight size={18} />
          </motion.button>
        </div>
      </motion.div>
    </section>
  );
}
