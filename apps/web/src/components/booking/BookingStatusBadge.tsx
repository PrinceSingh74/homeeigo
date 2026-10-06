"use client";

import { Clock, Truck, CheckCircle2, XCircle, TimerOff, UserX, UserRoundX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/bookings";
import { STATUS_CONFIG } from "@/lib/booking-status";

const ICONS: Record<BookingStatus, typeof Clock> = {
  confirmed: Clock,
  in_progress: Truck,
  completed: CheckCircle2,
  cancelled: XCircle,
  expired: TimerOff,
  customer_no_show: UserX,
  provider_no_show: UserRoundX,
};

export function BookingStatusBadge({
  status,
  live,
  size = "md",
  label,
}: {
  status: BookingStatus;
  live?: boolean;
  size?: "sm" | "md";
  /**
   * The badge text for THIS booking (statusConfigFor(...).shortLabel). A pre-start booking is
   * "Awaiting payment", "Finding a pro" or "Upcoming" depending on its real state; without it the
   * neutral label for the status is shown.
   */
  label?: string;
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
      {label ?? cfg.shortLabel}
    </span>
  );
}
