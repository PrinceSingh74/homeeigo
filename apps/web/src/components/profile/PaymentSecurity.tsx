"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronRight,
  CreditCard,
  Lock,
  Shield,
  Smartphone,
} from "lucide-react";
import {
  profileInteractiveSurface,
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { PROFILE_PAYMENT_ITEMS, PROFILE_SECURITY_ITEMS } from "@/lib/profile-dashboard";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const PAY_ICONS: Record<string, typeof CreditCard> = {
  cards: CreditCard,
  upi: Smartphone,
  secure: Lock,
  "2fa": Shield,
};

export function PaymentSecurity() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(profilePanelShell, "flex h-full min-w-0 flex-col", profilePanelPad)}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-content">
          Payment & Security
        </h2>
        <button
          type="button"
          onClick={() => openOverlay("wallet")}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Manage
        </button>
      </div>

      <ul className="mb-5 flex flex-col gap-2.5 sm:mb-6 sm:gap-3">
        {PROFILE_PAYMENT_ITEMS.map((item) => {
          const Icon = PAY_ICONS[item.id] ?? CreditCard;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  if (item.id === "cards" || item.id === "upi") openOverlay("wallet");
                  else showToast(item.detail, "info");
                }}
                className={cn(
                  profileInteractiveSurface,
                  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[10px] p-3 sm:gap-4 sm:p-4",
                )}
              >
                <span className="grid size-10 place-items-center rounded-lg bg-[#EFF6FF] text-primary dark:bg-primary/15">
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-display text-[13px] font-bold text-content">
                    {item.title}
                  </span>
                  <span className="block text-xs text-muted">{item.detail}</span>
                </span>
                <ChevronRight size={16} className="text-muted" />
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="mb-2.5 font-display text-sm font-bold text-content sm:mb-3">
        Security Settings
      </h3>
      <ul className="flex flex-col gap-2">
        {PROFILE_SECURITY_ITEMS.map((item) => (
          <li key={item.title}>
            <div className="flex gap-3 rounded-lg px-1 py-2 transition hover:bg-primary/5 dark:hover:bg-white/[0.06]">
              <Check size={16} className="mt-0.5 shrink-0 text-success" strokeWidth={2.5} />
              <span>
                <span className="block font-display text-[13px] font-bold text-content">
                  {item.title}
                </span>
                <span className="block text-[11px] text-muted">{item.description}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
