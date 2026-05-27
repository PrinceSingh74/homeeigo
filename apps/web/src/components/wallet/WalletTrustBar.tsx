"use client";

import { motion, useReducedMotion } from "framer-motion";
import { WALLET_TRUST_CARDS } from "@/lib/wallet-dashboard";

export function WalletTrustBar() {
  const reduce = useReducedMotion();

  return (
    <section className="rounded-xl bg-luxe p-4 dark:bg-charcoal/40 sm:rounded-2xl sm:p-6 lg:p-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {WALLET_TRUST_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06, duration: 0.4 }}
              className="wallet-panel flex flex-col items-center gap-2.5 p-4 text-center transition sm:gap-3 sm:p-6"
            >
              <span
                className="grid size-10 place-items-center rounded-xl sm:size-12"
                style={{ backgroundColor: card.bg, color: card.color }}
              >
                <Icon size={20} className="sm:hidden" />
                <Icon size={24} className="hidden sm:block" />
              </span>
              <p className="font-display text-[12px] font-bold text-content sm:text-sm">{card.title}</p>
              <p className="text-[10px] leading-snug text-muted sm:text-xs">{card.text}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
