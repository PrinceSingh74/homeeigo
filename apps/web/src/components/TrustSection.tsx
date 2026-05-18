"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck,
  UserCheck,
  Lock,
  Cpu,
  MapPin,
  Headphones,
  type LucideIcon,
} from "lucide-react";

type Trust = { icon: LucideIcon; l1: string; l2: string };

const TRUSTS: Trust[] = [
  { icon: ShieldCheck, l1: "Verified", l2: "Professionals" },
  { icon: UserCheck, l1: "Background", l2: "Checks" },
  { icon: Lock, l1: "Secure", l2: "Payments" },
  { icon: Cpu, l1: "AI Fraud", l2: "Detection" },
  { icon: MapPin, l1: "Live", l2: "Tracking" },
  { icon: Headphones, l1: "Support", l2: "24/7" },
];

export function TrustSection() {
  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        className="mb-10 font-display text-3xl font-bold text-content sm:text-4xl lg:text-5xl"
      >
        Trust &amp; Safety
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="grid grid-cols-2 gap-10 rounded-[32px] border border-line bg-surface p-12 shadow-e3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {TRUSTS.map((t, i) => {
          const Icon = t.icon;
          return (
            <motion.div
              key={t.l1}
              initial={{ opacity: 0, scale: 0.85 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.06 }}
              className="flex flex-col items-center text-center"
            >
              <span className="grid size-20 place-items-center rounded-3xl bg-primary/8 text-primary">
                <Icon size={36} strokeWidth={2} />
              </span>
              <p className="mt-4 text-sm font-semibold leading-tight text-muted">
                {t.l1}
                <br />
                {t.l2}
              </p>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
