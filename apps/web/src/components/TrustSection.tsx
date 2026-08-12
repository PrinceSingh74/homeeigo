"use client";

import { m as motion } from "framer-motion";
import {
  ShieldCheck,
  UserCheck,
  Lock,
  Cpu,
  MapPin,
  Headphones,
  type LucideIcon,
} from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";

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
    <PageSection>
      <SectionHeader title="Trust & Safety" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative grid grid-cols-2 gap-4 overflow-hidden rounded-[24px] glass-card card-sheen p-5 sm:grid-cols-3 sm:gap-6 sm:rounded-[32px] sm:p-8 lg:grid-cols-6 lg:gap-8 lg:rounded-[36px] lg:p-12"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 sheen rounded-t-[36px]"
        />
        {TRUSTS.map((t, i) => {
          const Icon = t.icon;
          return (
            <motion.div
              key={t.l1}
              initial={{ opacity: 0, scale: 0.85 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.06 }}
              className="group relative flex flex-col items-center text-center"
            >
              <span
                className="grid size-14 place-items-center rounded-2xl text-emerald-600 ring-1 ring-white/50 transition-transform duration-300 group-hover:scale-110 sm:size-20 sm:rounded-3xl dark:text-emerald-400"
                style={{
                  background:
                    "linear-gradient(135deg, rgb(16 185 129 / 0.16) 0%, rgb(20 184 166 / 0.08) 100%)",
                  boxShadow:
                    "inset 0 2px 4px rgb(255 255 255 / 0.6), 0 10px 20px -8px rgb(16 185 129 / 0.35)",
                }}
              >
                <Icon size={28} strokeWidth={2} className="sm:size-9" />
              </span>
              <p className="mt-4 text-sm font-semibold leading-tight text-muted transition-colors duration-300 group-hover:text-content">
                {t.l1}
                <br />
                {t.l2}
              </p>
            </motion.div>
          );
        })}
      </motion.div>
    </PageSection>
  );
}
