"use client";

import { Clock, Truck, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/bookings";
import { STATUS_CONFIG } from "@/lib/booking-status";

const ICONS = {
  confirmed: Clock,
  in_progress: Truck,
  completed: CheckCircle2,
  cancelled: XCircle,
};

export function BookingStatusBadge({
  status,
  live,
  size = "md",
}: {
  status: BookingStatus;
  live?: boolean;
  size?: "sm" | "md";
}) {
  const cfg = STATUS_CONFIG[status];
  const Icon = ICONS[status];
  const sm = size === "sm";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-bold",
        sm ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
      )}
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {live && status === "in_progress" && (
        <span
          className="size-1.5 animate-pulse rounded-full"
          style={{ backgroundColor: cfg.accent }}
        />
      )}
      <Icon size={sm ? 12 : 14} strokeWidth={2.5} />
      {cfg.shortLabel}
    </span>
  );
}
