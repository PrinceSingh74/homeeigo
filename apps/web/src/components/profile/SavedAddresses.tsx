"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, MoreVertical, Plus } from "lucide-react";
import {
  profileInteractiveSurface,
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { PROFILE_ADDRESSES } from "@/lib/profile-dashboard";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function SavedAddresses() {
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
        <h2 className="font-display text-base font-bold text-content">Saved Addresses</h2>
        <button
          type="button"
          onClick={() => openOverlay("location")}
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-primary hover:underline"
        >
          Manage
          <ChevronRight size={14} />
        </button>
      </div>

      <ul className="flex flex-1 flex-col gap-3">
        {PROFILE_ADDRESSES.map((addr) => (
          <li key={addr.id}>
            <button
              type="button"
              onClick={() => showToast(`${addr.type} address selected`, "info")}
              className={cn(
                profileInteractiveSurface,
                "relative w-full rounded-xl p-3.5 text-left sm:p-4",
              )}
            >
              <span className="absolute right-3 top-3 text-muted opacity-60 hover:opacity-100">
                <MoreVertical size={16} />
              </span>
              <span
                className={`inline-block rounded-md px-2.5 py-0.5 text-[11px] font-bold ${addr.badgeBg}`}
              >
                {addr.type}
                {addr.tag ? ` (${addr.tag})` : ""}
              </span>
              <p className="mt-2 line-clamp-2 pr-6 font-display text-[13px] font-bold leading-snug text-content">
                {addr.line1}
              </p>
              <p className="mt-1 line-clamp-1 text-xs text-muted">{addr.line2}</p>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => openOverlay("location")}
        className={cn(
          profileInteractiveSurface,
          "mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl border-dashed p-3.5 text-left sm:p-4",
        )}
      >
        <span className="grid size-9 place-items-center rounded-lg bg-[#EFF6FF] text-primary dark:bg-primary/15">
          <Plus size={18} />
        </span>
        <span className="text-[13px] font-semibold text-primary">Add New Address</span>
      </button>
    </motion.section>
  );
}
