"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Clock, Check, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { BOOKING_TIMES } from "@/lib/services";
import {
  formatDateLabel,
  formatTimeLabel,
  toYmdLocal,
  toHm24Local,
  parseYmdLocal,
  parseHm24OnDate,
  apply12hTimeOnDate,
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
};

export function BookingScheduleSection({
  scheduledAt,
  onScheduledAtChange,
  onInvalid,
  step = 3,
  className,
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
    onScheduledAtChange(t);
  };

  const onNativeDateChange = (value: string) => {
    const day = parseYmdLocal(value);
    if (day) onScheduledAtChange(applyDatePart(scheduledAt, day));
  };

  const onNativeTimeChange = (value: string) => {
    const t = parseHm24OnDate(value, scheduledAt);
    if (t) onScheduledAtChange(t);
  };

  return (
    <div className={className}>
      <div className="mb-4 flex items-start gap-2.5 sm:mb-6 sm:gap-3">
        {step != null && (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-aurora text-xs font-bold text-white shadow-glow-blue sm:size-8 sm:text-sm">
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
          <Calendar size={16} className="shrink-0 text-primary sm:size-[18px]" />
          <span className="truncate">{formatDateLabel(scheduledAt)}</span>
        </button>
        <button
          type="button"
          onClick={openTimePicker}
          className="flex min-w-0 items-center justify-center gap-2 rounded-xl border border-line glass-card px-3 py-3 text-xs font-bold text-content transition hover:-translate-y-0.5 sm:rounded-2xl sm:px-4 sm:py-3.5 sm:text-sm"
        >
          <Clock size={16} className="shrink-0 text-primary sm:size-[18px]" />
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

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none snap-x sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0 md:grid-cols-6">
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
                  ? "bg-aurora text-white shadow-glow-blue"
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

      <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none snap-x sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0 md:grid-cols-6">
        {BOOKING_TIMES.map((t) => {
          const picked = apply12hTimeOnDate(scheduledAt, t);
          const active =
            !!picked &&
            picked.getHours() === scheduledAt.getHours() &&
            picked.getMinutes() === scheduledAt.getMinutes();
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                const next = apply12hTimeOnDate(scheduledAt, t);
                if (next) onScheduledAtChange(next);
              }}
              className={cn(
                "min-w-[4.25rem] shrink-0 snap-start rounded-xl px-2 py-3 text-xs font-semibold transition sm:min-w-0 sm:rounded-2xl sm:py-4 sm:text-sm",
                active
                  ? "bg-aurora text-white shadow-glow-blue"
                  : "glass-card text-content hover:-translate-y-0.5",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 ring-1 ring-success/20">
        <Check size={16} className="shrink-0 text-success" strokeWidth={3} />
        <span className="flex-1 text-sm font-semibold text-success">
          Great! Fastest available slot secured.
        </span>
        <Flame size={14} className="shrink-0 text-warning" />
      </div>
    </div>
  );
}
