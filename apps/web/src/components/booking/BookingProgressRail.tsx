"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Circle, CircleDot, Flag, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { coreApi } from "@/services/core/api";
import type { BackendBooking } from "@/types/backend";
import {
  BOOKING_END_NOTE,
  PROGRESS_STATE_WORD,
  deriveBookingProgress,
  type ProgressStageState,
} from "@/lib/booking-progress";
import { useBookingExecutionQuery } from "./BookingExecution";
import { useBookingCompletionQuery } from "./BookingCompletion";

/**
 * The booking's six real stages — arrival, start check, service started, work, quality check,
 * completion — from `deriveBookingProgress`. Each stage shows the time the server recorded and
 * nothing when it recorded none. State is an icon plus a word, never colour alone.
 */

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

const LOOK: Record<ProgressStageState, { Icon: typeof Check; dot: string; line: string; label: string }> = {
  done: { Icon: Check, dot: "border-success bg-success text-white", line: "bg-success", label: "text-content" },
  current: { Icon: CircleDot, dot: "border-primary bg-primary/10 text-primary", line: "bg-line", label: "text-content" },
  attention: { Icon: Flag, dot: "border-warning bg-warning/10 text-warning", line: "bg-line", label: "text-content" },
  upcoming: { Icon: Circle, dot: "border-line bg-surface text-muted", line: "bg-line", label: "text-muted" },
  skipped: { Icon: Minus, dot: "border-line bg-surface text-muted", line: "bg-line", label: "text-muted" },
  not_reached: { Icon: Minus, dot: "border-line bg-surface text-muted", line: "bg-line", label: "text-muted" },
};

export function BookingProgressRail({
  bookingId,
  booking,
  loading,
  failed,
}: {
  bookingId: string;
  /** GET /api/bookings/:id — undefined until it has loaded. */
  booking: BackendBooking | undefined;
  loading: boolean;
  failed: boolean;
}) {
  // Same key as ServiceStartPin's poll, so a live PIN updates the rail; this observer does not poll.
  const pinQ = useQuery({
    queryKey: ["bookings", "start-pin", bookingId || "none"],
    queryFn: () => coreApi.bookings.startPin(bookingId),
    enabled: !!bookingId,
    staleTime: 5_000,
    retry: 1,
  });
  const executionQ = useBookingExecutionQuery(bookingId);
  const completionQ = useBookingCompletionQuery(bookingId);

  if (!booking) {
    return (
      <div className="rounded-2xl glass-card p-4 text-sm text-muted" role="status" data-testid="booking-progress-pending">
        {loading
          ? "Loading progress…"
          : failed
            ? "We couldn't load this booking's progress. Check your connection and reopen the booking."
            : "Progress isn't available for this booking yet."}
      </div>
    );
  }

  const { stages, ended } = deriveBookingProgress({
    booking,
    startPin: pinQ.data ?? null,
    execution: executionQ.data ?? null,
    completion: completionQ.data ?? null,
  });

  return (
    <div className="rounded-2xl glass-card p-4" data-testid="booking-progress">
      {ended ? (
        <p className="mb-4 rounded-xl border border-line bg-surface/60 px-3 py-2 text-sm text-content" data-testid="booking-progress-ended">
          {BOOKING_END_NOTE[ended]}
        </p>
      ) : null}
      <ol className="space-y-0">
        {stages.map((s, i) => {
          const last = i === stages.length - 1;
          const look = LOOK[s.state];
          const time = s.at ? formatTime(s.at) : "";
          const due = s.dueAt ? formatTime(s.dueAt) : "";
          return (
            <li
              key={s.id}
              className="flex gap-4"
              aria-current={s.state === "current" ? "step" : undefined}
              data-testid={`booking-progress-${s.id}`}
              data-state={s.state}
            >
              <div className="flex flex-col items-center">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border-2", look.dot)}>
                  <look.Icon size={14} strokeWidth={3} aria-hidden="true" />
                </span>
                {!last && <span className={cn("my-1 min-h-6 w-0.5 flex-1 rounded-full", look.line)} aria-hidden="true" />}
              </div>
              <div className={cn("min-w-0 flex-1 pb-5", last && "pb-0")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={cn("text-sm font-semibold", look.label)}>{s.label}</p>
                  <p className={cn("text-xs", s.state === "current" || s.state === "attention" ? "font-bold text-content" : "text-muted")}>
                    {PROGRESS_STATE_WORD[s.state]}
                  </p>
                </div>
                {time ? (
                  <p className="mt-0.5 text-xs text-muted">
                    <time dateTime={s.at ?? undefined}>{time}</time>
                  </p>
                ) : null}
                {due ? <p className="mt-0.5 text-xs text-muted">Confirms automatically on {due}</p> : null}
                {s.detail ? <p className="mt-0.5 break-words text-xs text-muted">{s.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
