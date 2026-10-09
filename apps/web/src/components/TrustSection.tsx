"use client";

import { m as motion } from "framer-motion";
import {
  ShieldCheck,
  UserCheck,
  Lock,
  Receipt,
  MapPin,
  Headphones,
  type LucideIcon,
} from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";

type Trust = { icon: LucideIcon; l1: string; l2: string };

// Each line is something the platform does for every booking. A start PIN is not one of them:
// it is shown on the visit only when that service requires one. Identity and background checks
// are matching gates on the services that configure them, not a blanket claim.
const TRUSTS: Trust[] = [
  { icon: ShieldCheck, l1: "Approved", l2: "Professionals" },
  { icon: UserCheck, l1: "Your slot", l2: "you choose" },
  { icon: Lock, l1: "Secure", l2: "Payments" },
  { icon: Receipt, l1: "Itemised", l2: "Pricing" },
  { icon: MapPin, l1: "Live", l2: "Tracking" },
  { icon: Headphones, l1: "In-app", l2: "Support" },
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
        className="relative grid grid-cols-2 gap-4 overflow-hidden rounded-3xl glass-card card-sheen p-5 sm:grid-cols-3 sm:gap-6 sm:p-8 lg:grid-cols-6 lg:gap-8 lg:p-12"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 sheen rounded-t-3xl"
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
                className="grid size-14 place-items-center rounded-xl text-brand ring-1 ring-white/50 transition-transform duration-300 group-hover:scale-110 sm:size-20 sm:rounded-2xl"
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
