"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When provided, asks for a freeform reason before confirming */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** If true, reason text is required. Defaults to true when `reasonLabel` is set. */
  reasonRequired?: boolean;
  isLoading?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired,
  isLoading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const isReasonRequired = reasonRequired ?? !!reasonLabel;
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={() => {
        if (!isLoading) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => !isLoading && onClose()}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              destructive ? "bg-red-500/15 text-red-400" : "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
            }`}
            aria-hidden
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm text-[var(--color-biz-muted)]">{description}</p>
            ) : null}
            {reasonLabel ? (
              <div className="mt-3">
                <label className="text-xs text-[var(--color-biz-muted)]">{reasonLabel}</label>
                <textarea
                  rows={3}
                  value={reason}
                  disabled={isLoading}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={reasonPlaceholder}
                  className="mt-1 w-full resize-none rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-md border border-[var(--color-biz-line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading || (isReasonRequired && reason.trim().length === 0)}
            onClick={() =>
              void onConfirm(reasonLabel ? reason.trim() || undefined : undefined)
            }
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
              destructive
                ? "bg-red-500/90 text-white hover:bg-red-500"
                : "bg-[var(--color-biz-accent)] text-black hover:opacity-90"
            }`}
          >
            {isLoading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
