"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Calendar, Lock, Shield } from "lucide-react";
import { profilePanelShell } from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { PROFILE_TRUST_CARDS } from "@/lib/profile-dashboard";

const TRUST_ICONS = {
  badge: BadgeCheck,
  lock: Lock,
  calendar: Calendar,
  shield: Shield,
} as const;

export function InfoCards() {
  const reduce = useReducedMotion();

  return (
    <section className={cn(profilePanelShell, "p-3 sm:p-6")}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {PROFILE_TRUST_CARDS.map((card, i) => {
          const Icon = TRUST_ICONS[card.icon as keyof typeof TRUST_ICONS];
          return (
            <motion.div
              key={card.title}
              initial={reduce ? false : { opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className={cn(
                profilePanelShell,
                "flex flex-col items-center gap-2 rounded-xl p-3 text-center transition hover:shadow-[0_8px_20px_rgb(16_185_129/0.1)] sm:gap-3 sm:p-5",
              )}
            >
              <span
                className="grid size-12 place-items-center rounded-[10px]"
                style={{ backgroundColor: card.bg, color: card.color }}
              >
                <Icon size={24} />
              </span>
              <p className="font-display text-[13px] font-bold text-content">{card.title}</p>
              <p className="text-[11px] leading-snug text-muted">{card.description}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
