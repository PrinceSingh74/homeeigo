"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 left-1/2 z-[120] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 lg:bottom-8"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            onClick={() => dismiss(t.id)}
            className={cn(
              "pointer-events-auto rounded-xl px-4 py-3 text-left text-sm font-semibold shadow-lg",
              t.type === "success" && "bg-partner-success text-white",
              t.type === "error" && "bg-partner-danger text-white",
              t.type === "info" && "bg-partner-card text-partner-text ring-1 ring-partner-line",
            )}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
