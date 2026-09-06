"use client";

import { CalendarClock, ArrowRightLeft, PlayCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";

type LeadMobileActionSheetProps = {
  open: boolean;
  onClose: () => void;
  onStatus: () => void;
  onFollowUp: () => void;
  onStartApplication?: () => void;
  showStartApplication?: boolean;
};

export function LeadMobileActionSheet({
  open,
  onClose,
  onStatus,
  onFollowUp,
  onStartApplication,
  showStartApplication,
}: LeadMobileActionSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] xl:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">CRM actions</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-2">
          {showStartApplication && onStartApplication ? (
            <SheetAction icon={PlayCircle} label="Start application" onClick={onStartApplication} />
          ) : null}
          <SheetAction icon={ArrowRightLeft} label="Change status" onClick={onStatus} />
          <SheetAction icon={CalendarClock} label="Schedule follow-up" onClick={onFollowUp} primary />
        </div>
      </div>
    </div>
  );
}

function SheetAction({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof CalendarClock;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold",
        primary
          ? "bg-[var(--color-biz-accent)] text-white"
          : "border border-[var(--color-biz-line)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
