"use client";

import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import {
  Star,
  Users,
  Headphones,
  Cpu,
  RotateCcw,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { PageSection } from "@/components/layout/PageSection";

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
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <PageSection>
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#064e3b_0%,#0f766e_55%,#115e59_100%)] p-6 shadow-[0_24px_60px_-18px_rgb(6_78_59/0.55)] sm:rounded-[32px] sm:p-10 lg:rounded-[40px] lg:p-16"
      >
        {/* sheen */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />

        {/* big 3D crown */}
        <div className="pointer-events-none absolute right-10 top-1/2 hidden -translate-y-1/2 lg:block">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full halo"
          />
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 360] }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 grid place-items-center"
          >
            <span className="size-72 rounded-full border-2 border-dashed border-gold/50" />
          </motion.div>
          <motion.div
            animate={reduce ? undefined : { y: [0, -14, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            className="relative size-60"
          >
            <Image
              src="/crown-3d.png"
              alt="Premium crown"
              width={240}
              height={240}
              sizes="240px"
              className="size-60 object-contain drop-shadow-[0_24px_48px_rgb(212_175_55/0.45)]"
            />
          </motion.div>
        </div>

        <div className="relative lg:max-w-3xl">
          <h2
            className="font-display font-bold tracking-wide text-white"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            HOMEEIGO PREMIUM 👑
          </h2>
          <p className="mt-3 text-lg text-white/80">
            Unlock the elite home-care experience
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 sm:mt-10 sm:grid-cols-3 lg:grid-cols-5">
            {BENEFITS.map((b, i) => {
              const Icon = b.icon;
              return (
                <motion.div
                  key={b.l1}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.07 }}
                  className="group flex flex-col items-center text-center"
                >
                  <span className="grid size-14 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] backdrop-blur-sm transition-transform duration-300 group-hover:scale-110 sm:size-16">
                    <Icon size={24} strokeWidth={2.2} />
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
            onClick={() => openOverlay("premium")}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-10 inline-flex h-14 items-center gap-2 rounded-2xl bg-white px-9 text-base font-bold text-emerald-800 shadow-e3 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Upgrade Now
            <ArrowRight size={18} />
          </motion.button>
        </div>
      </motion.div>
    </PageSection>
  );
}
