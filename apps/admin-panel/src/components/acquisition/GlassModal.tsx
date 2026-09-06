"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type GlassModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  onClose: () => void;
};

export function GlassModal({
  open,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  isLoading = false,
  onClose,
}: GlassModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, isLoading, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="glass-modal-title"
      className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={() => !isLoading && onClose()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full transition-all duration-200",
          "biz-glass-panel border-[var(--color-biz-line-strong)] shadow-2xl",
          "max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl",
          size === "sm" && "sm:max-w-md",
          size === "md" && "sm:max-w-lg",
          size === "lg" && "sm:max-w-2xl",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-biz-line)] px-5 py-4">
          <div>
            <h2 id="glass-modal-title" className="font-display text-lg font-bold tracking-tight">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-sm text-[var(--color-biz-muted)]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => !isLoading && onClose()}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--color-biz-muted)] transition hover:bg-[var(--color-biz-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-biz-line)] px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
