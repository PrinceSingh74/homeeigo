"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Globe,
  Headphones,
  LogOut,
  Shield,
} from "lucide-react";
import {
  profileInteractiveSurface,
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { PROFILE_SETTINGS } from "@/lib/profile-dashboard";
import { useAppStore } from "@/stores/app-store";

const SETTING_ICONS = {
  bell: Bell,
  shield: Shield,
  globe: Globe,
  headphones: Headphones,
  logout: LogOut,
} as const;

export function ProfileSettings() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);

  const handle = (action: string) => {
    if (action === "settings") openOverlay("settings");
    else if (action === "support") openOverlay("support");
    else if (action === "logout") showToast("Signed out successfully", "success");
    else showToast("Preference saved", "success");
  };

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(profilePanelShell, "flex h-full min-w-0 flex-col", profilePanelPad)}
    >
      <h2 className="mb-5 font-display text-lg font-bold text-content">Settings</h2>

      <ul className="grid flex-1 gap-2.5 sm:gap-3">
        {PROFILE_SETTINGS.map((item) => {
          const Icon = SETTING_ICONS[item.icon as keyof typeof SETTING_ICONS];
          const danger = "danger" in item && item.danger;

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handle(item.action)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl p-3.5 text-left sm:p-4",
                  danger
                    ? "border border-[#FECACA] bg-[#FEE2E2] transition hover:border-primary hover:bg-[#FCA5A5]/30 dark:border-error/30 dark:bg-error/10 dark:hover:bg-error/20"
                    : profileInteractiveSurface,
                )}
              >
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-lg text-white",
                    item.color,
                  )}
                >
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block font-display text-[13px] font-bold",
                      danger ? "text-error" : "text-content",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="block text-[11px] text-muted">{item.description}</span>
                </span>
                <ChevronRight size={16} className={danger ? "text-error/60" : "text-muted"} />
              </button>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
