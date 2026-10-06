"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import {
  formatDateLabel,
  formatTimeLabel,
  toYmdLocal,
  toHm24Local,
  parseYmdLocal,
  parseHm24OnDate,
  applyDatePart,
  sameCalendarDay,
  quickNextDays,
  quickDayTitle,
  quickDaySubtitle,
} from "@/lib/booking-datetime";

export type BookingScheduleSectionProps = {
  scheduledAt: Date;
  onScheduledAtChange: (date: Date) => void;
  onInvalid?: (message: string) => void;
  /** Matches mobile step badge (e.g. 3 on schedule). */
  step?: number;
  className?: string;
  /**
   * The slots the SERVER says are bookable for the chosen day. When present these replace the static
   * chips entirely: the list, the times and the verdicts are the backend's, not this component's.
   * Absent or empty: say so. This component does not invent times.
   */
  slots?: { start: string; available: boolean; reason?: string }[];
  slotsLoading?: boolean;
  /**
   * False until the customer taps a time. A prefilled clock must not look chosen and must not be
   * payable. Omit it (reschedule) and the current time stays selected.
   */
  timeSelected?: boolean;
  /** Time chip, manual time, or the clock picker. Date changes stay on `onScheduledAtChange`. */
  onPickTime?: (date: Date) => void;
};

/** Customer-safe wording for a slot the server refused. Never invents a reason it was not given. */
const SLOT_REASON_COPY: Record<string, string> = {
  SLOT_IN_PAST: "This time has passed",
  LEAD_TIME_NOT_MET: "Too soon — needs more notice",
  BEYOND_ADVANCE_WINDOW: "Too far ahead",
  SAME_DAY_UNAVAILABLE: "Not available same day",
  BLACKOUT_DATE: "Not available on this date",
  OUTSIDE_WORKING_HOURS: "No professional works at this time",
  PROVIDER_BUSY: "Fully booked",
  NO_QUALIFIED_PROVIDER: "No professional available",
  OUTSIDE_OPERATING_WINDOW: "Outside booking hours",
  CUSTOMER_HAS_BOOKING: "You already have a booking at this time",
  PARTNER_OFFLINE: "Your chosen professional isn't online for this time — pick a later date",
  INVALID_DATE: "Unavailable",
};

export function BookingScheduleSection({
  scheduledAt,
  onScheduledAtChange,
  onInvalid,
  step = 3,
  className,
  slots,
  slotsLoading,
  timeSelected = true,
  onPickTime,
}: BookingScheduleSectionProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  const [manualDateStr, setManualDateStr] = useState(() => toYmdLocal(scheduledAt));
  const [manualTimeStr, setManualTimeStr] = useState(() => toHm24Local(scheduledAt));

  const quickDays = useMemo(() => quickNextDays(6), []);

  useEffect(() => {
    setManualDateStr(toYmdLocal(scheduledAt));
    setManualTimeStr(toHm24Local(scheduledAt));
  }, [scheduledAt]);

  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.click();
  };

  const openTimePicker = () => {
    const el = timeInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.click();
  };

  const applyManualDate = () => {
    const day = parseYmdLocal(manualDateStr);
    if (!day) {
      onInvalid?.("Invalid date — use YYYY-MM-DD");
      setManualDateStr(toYmdLocal(scheduledAt));
      return;
    }
    onScheduledAtChange(applyDatePart(scheduledAt, day));
  };

  const applyManualTime = () => {
    const t = parseHm24OnDate(manualTimeStr, scheduledAt);
    if (!t) {
      onInvalid?.("Invalid time — use HH:MM (24h)");
      setManualTimeStr(toHm24Local(scheduledAt));
      return;
    }
    (onPickTime ?? onScheduledAtChange)(t);
  };

  const onNativeDateChange = (value: string) => {
    const day = parseYmdLocal(value);
    if (day) onScheduledAtChange(applyDatePart(scheduledAt, day));
  };

  const onNativeTimeChange = (value: string) => {
    const t = parseHm24OnDate(value, scheduledAt);
    if (t) (onPickTime ?? onScheduledAtChange)(t);
  };

  return (
    <div className={className}>
      <div className="mb-4 flex items-start gap-2.5 sm:mb-6 sm:gap-3">
        {step != null && (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-xs font-bold text-white shadow-[0_6px_18px_-6px_rgb(16_185_129/0.55)] sm:size-8 sm:text-sm">
            {step}
          </span>
        )}
        <div className="min-w-0">
          <h3
            className="font-display font-bold tracking-tight text-content"
            style={{ fontSize: "clamp(1.25rem, 4vw, 1.875rem)" }}
          >
            Date &amp; time
          </h3>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            Any day &amp; time — quick picks, calendar, or type below
          </p>
        </div>
      </div>

      <input
        ref={dateInputRef}
        type="date"
        value={toYmdLocal(scheduledAt)}
        onChange={(e) => onNativeDateChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={timeInputRef}
        type="time"
        value={toHm24Local(scheduledAt)}
        onChange={(e) => onNativeTimeChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      <div className="mb-4 grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 sm:gap-3">
        <button
          type="button"
          onClick={openDatePicker}
          className="flex min-w-0 items-center justify-center gap-2 rounded-xl border border-line glass-card px-3 py-3 text-xs font-bold text-content transition hover:-translate-y-0.5 sm:rounded-2xl sm:px-4 sm:py-3.5 sm:text-sm"
        >
          <Calendar size={16} className="shrink-0 text-emerald-600 sm:size-[18px]" />
          <span className="truncate">{formatDateLabel(scheduledAt)}</span>
        </button>
        <button
          type="button"
          onClick={openTimePicker}
          className="flex min-w-0 items-center justify-center gap-2 rounded-xl border border-line glass-card px-3 py-3 text-xs font-bold text-content transition hover:-translate-y-0.5 sm:rounded-2xl sm:px-4 sm:py-3.5 sm:text-sm"
        >
          <Clock size={16} className="shrink-0 text-emerald-600 sm:size-[18px]" />
          <span className="truncate">{formatTimeLabel(scheduledAt)}</span>
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input
          label="Date (YYYY-MM-DD)"
          type="text"
          inputMode="numeric"
          value={manualDateStr}
          onChange={(e) => setManualDateStr(e.target.value)}
          onBlur={applyManualDate}
          placeholder="2026-05-22"
          size="md"
          showClear={false}
          containerClassName="rounded-2xl bg-surface/60"
        />
        <Input
          label="Time (24h)"
          type="text"
          inputMode="numeric"
          value={manualTimeStr}
          onChange={(e) => setManualTimeStr(e.target.value)}
          onBlur={applyManualTime}
          placeholder="14:30"
          size="md"
          showClear={false}
          containerClassName="rounded-2xl bg-surface/60"
        />
      </div>

      {/* A horizontal scroller on phones: focusable, so a keyboard can scroll it even when every item is disabled. */}
      <div
        role="group"
        aria-label="Choose a day"
        tabIndex={0}
        className="-mx-1 flex gap-2 overflow-x-auto rounded-xl px-1 pb-1 outline-none scrollbar-none snap-x focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0 md:grid-cols-6"
      >
        {quickDays.map((d) => {
          const active = sameCalendarDay(scheduledAt, d);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onScheduledAtChange(applyDatePart(scheduledAt, d))}
              className={cn(
                "flex min-w-[4.5rem] shrink-0 snap-start flex-col items-center rounded-xl py-3 text-xs transition sm:min-w-0 sm:rounded-2xl sm:py-4 sm:text-sm",
                active
                  ? "bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_10px_26px_-8px_rgb(16_185_129/0.55)]"
                  : "glass-card text-content hover:-translate-y-0.5",
              )}
            >
              <span className="font-bold">{quickDayTitle(d)}</span>
              <span
                className={cn(
                  "text-[10px] sm:text-inherit",
                  active ? "text-white/80" : "text-muted",
                )}
              >
                {quickDaySubtitle(d)}
              </span>
            </button>
          );
        })}
      </div>

      {/*
        The times come from the server (Wave 4): a 30-minute grid for the chosen day, each slot
        already judged against the service's rules, the partner's hours and real occupancy. The six
        hardcoded chips this replaces were a client guess the backend had never agreed to, so a
        customer could pick a time the platform would refuse. They remain only as the fallback while
        the server list is loading.
      */}
      <div
        role="group"
        aria-label="Choose a time"
        tabIndex={0}
        className="-mx-1 mt-4 flex gap-2 overflow-x-auto rounded-xl px-1 pb-1 outline-none scrollbar-none snap-x focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0 md:grid-cols-6"
      >
        {(slots ?? []).length > 0
          ? slots!.map((slot) => {
              const at = new Date(slot.start);
              const active = timeSelected && at.getTime() === scheduledAt.getTime();
              const label = formatTimeLabel(at);
              return (
                <button
                  key={slot.start}
                  type="button"
                  disabled={!slot.available}
                  title={slot.available ? undefined : (SLOT_REASON_COPY[slot.reason ?? ""] ?? "Unavailable")}
                  aria-label={slot.available ? label : `${label} — ${SLOT_REASON_COPY[slot.reason ?? ""] ?? "unavailable"}`}
                  onClick={() => (onPickTime ?? onScheduledAtChange)(at)}
                  className={cn(
                    "min-w-[4.25rem] shrink-0 snap-start rounded-xl px-2 py-3 text-xs font-semibold transition sm:min-w-0 sm:rounded-2xl sm:py-4 sm:text-sm",
                    !slot.available
                      ? "cursor-not-allowed border border-line bg-surface text-muted line-through opacity-60"
                      : active
                        ? "bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_10px_26px_-8px_rgb(16_185_129/0.55)]"
                        : "glass-card text-content hover:-translate-y-0.5",
                  )}
                >
                  {label}
                </button>
              );
            })
          : !slotsLoading && (
              <p className="px-1 text-sm font-medium text-muted">No times are available for this day.</p>
            )}
      </div>

      {slots && slots.length > 0 && slots.every((s) => !s.available) && (
        <p className="mt-3 text-sm font-medium text-muted">
          No times are available on this day. Please try another date.
        </p>
      )}
      {slotsLoading && !slots?.length && (
        <p className="mt-3 text-sm text-muted">Checking which times are free…</p>
      )}

      {/* Nothing is reserved until the booking is created: the backend checks the service's lead
          time, blackout dates and the partner's hours at that point and can still refuse this slot.
          The banner used to claim "Fastest available slot secured", which was true of no slot. */}
      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3">
        <Clock size={16} className="shrink-0 text-muted" strokeWidth={2.5} />
        <span className="flex-1 text-sm font-medium text-muted">
          We&apos;ll confirm this slot when you place the booking.
        </span>
      </div>
    </div>
  );
}
