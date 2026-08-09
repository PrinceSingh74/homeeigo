"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { usePartnerActiveBookingsQuery } from "@/hooks/use-partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";
import { formatInr, formatTime } from "@/lib/format";
import type { PartnerBooking } from "@/types/partner";
import { cn } from "@/lib/cn";

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function statusLabel(b: PartnerBooking) {
  if (b.status === "completed") return { label: "Completed", className: "text-partner-success" };
  if (b.status === "in_progress")
    return { label: "In progress", className: "text-partner-primary" };
  if (b.status === "cancelled" || b.status === "cancelled_by_provider" || b.status === "cancelled_by_user")
    return { label: "Cancelled", className: "text-partner-danger" };
  return { label: "Upcoming", className: "text-partner-warning" };
}

export function DashboardSchedule() {
  const { data, isLoading, isError } = usePartnerActiveBookingsQuery();

  const todayBookings = (data?.bookings ?? []).filter(
    (b) =>
      isToday(b.scheduledDate) ||
      (b.completedAt && isToday(b.completedAt)),
  );
  const total = todayBookings.reduce((s, b) => s + b.finalAmount, 0);

  return (
    <DashboardPanel title="Today's Schedule" href="/requests">
      {isLoading ? (
        <ul className={partnerLayout.listGap}>
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className={cn(
                "h-14 animate-pulse rounded-xl bg-white/[0.03]",
                partnerLayout.itemPad,
              )}
            />
          ))}
        </ul>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-partner-muted">
          Couldn&apos;t load schedule.
        </p>
      ) : todayBookings.length === 0 ? (
        <p className="py-8 text-center text-sm text-partner-muted">
          No jobs scheduled for today.
        </p>
      ) : (
        <ul className={partnerLayout.listGap}>
          {todayBookings.map((b) => {
            const { label, className } = statusLabel(b);
            return (
              <li
                key={b.id}
                className={cn(
                  "flex items-center gap-4",
                  partnerLayout.itemPad,
                  "transition hover:bg-white/[0.03]",
                )}
              >
                {b.status === "completed" ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-partner-success" />
                ) : (
                  <Clock className="h-6 w-6 shrink-0 text-partner-warning" />
                )}
                <span className="w-[72px] shrink-0 text-xs font-semibold tabular-nums text-partner-text">
                  {formatTime(b.scheduledDate)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[13px] font-semibold leading-tight text-partner-text">
                    {b.service.name}
                  </p>
                  <p className={cn("text-[11px] font-medium", className)}>{label}</p>
                </div>
                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-partner-accent">
                  {formatInr(b.finalAmount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-partner-line pt-5 text-sm">
        <span className="text-partner-text-secondary">
          {todayBookings.length} Job{todayBookings.length === 1 ? "" : "s"} today
        </span>
        <span className="font-display font-bold tabular-nums text-partner-accent">
          {formatInr(total)} Potential
        </span>
      </div>
    </DashboardPanel>
  );
}
