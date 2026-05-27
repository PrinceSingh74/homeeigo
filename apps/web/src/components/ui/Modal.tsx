"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  size = "md",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? "modal-title" : undefined}
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] glass-card shadow-e5 sm:rounded-[28px]",
              sizes[size],
              className,
            )}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-16 sheen"
            />
            {(title || true) && (
              <motion.div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
                {title ? (
                  <h2
                    id="modal-title"
                    className="font-display text-xl font-bold text-content"
                  >
                    {title}
                  </h2>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="grid size-10 place-items-center rounded-xl glass-card text-muted transition hover:text-content"
                >
                  <X size={20} />
                </button>
              </motion.div>
            )}
            <motion.div className="relative overflow-y-auto px-6 py-5">
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
