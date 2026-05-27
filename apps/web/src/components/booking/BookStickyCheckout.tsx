"use client";

import { ArrowRight, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { pageMax, pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

export function BookStickyCheckout({
  total,
  confirming,
  onConfirm,
}: {
  total: number;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 lg:hidden">
      <div
        className="pointer-events-auto border-t border-line glass dark:glass-dark shadow-[0_-12px_40px_rgb(0_0_0/0.12)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className={cn(pageMax, pagePadX, "flex items-center gap-3 pt-3")}>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Total payable
            </p>
            <p className="font-display text-xl font-bold text-aurora sm:text-2xl">
              ₹{total}
            </p>
          </div>
          <motion.button
            type="button"
            disabled={confirming}
            onClick={onConfirm}
            whileTap={{ scale: confirming ? 1 : 0.98 }}
            className="inline-flex h-12 min-w-[9.5rem] shrink-0 items-center justify-center gap-2 rounded-xl bg-premium px-4 text-sm font-bold text-white shadow-[0_12px_32px_-8px_rgb(124_58_237/0.55)] disabled:opacity-70 sm:h-14 sm:min-w-[11rem] sm:rounded-2xl sm:px-5"
          >
            <Lock size={16} className="shrink-0" />
            <span className="truncate">
              {confirming ? "Securing…" : "Confirm"}
            </span>
            {!confirming && <ArrowRight size={16} className="shrink-0" />}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
