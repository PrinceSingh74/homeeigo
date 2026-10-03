"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardList } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { DataUnavailable, HqLoading } from "./primitives";
import { renderScheduleField } from "@/lib/intelligence-render";

/**
 * Phase 9, Capability 12 — scheduled-report status on the existing Executive Reports page.
 *
 * ── What this must never imply ─────────────────────────────────────────────────
 *
 * That a report is scheduled. It is not. `executiveReportSchedule` is UNSET in all three fields, the
 * feature flag is off, and no `ScheduledJob` of this type exists. A panel showing a plausible next
 * run — or defaulting a blank hour to 08:00 — would manufacture a business decision nobody has made.
 *
 * The three parts are shown **separately** because they are separately undecided: an hour without a
 * recurrence schedules everything, a recurrence without an hour schedules nothing, and both without a
 * zone schedule the wrong moment for anyone outside the server's region.
 */
export const ScheduledReportStatus = memo(function ScheduledReportStatus() {
  const q = useQuery({
    queryKey: ["admin", "intelligence", "report-schedule"],
    queryFn: () => adminApi.reportScheduleStatus(),
    staleTime: 60_000,
    retry: 1,
  });

  if (q.isLoading) {
    return (
      <section aria-labelledby="sched-h" className="rounded-xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-4">
        <h2 id="sched-h" className="mb-3 font-semibold">Scheduled delivery</h2>
        <HqLoading label="Reading schedule state…" />
      </section>
    );
  }

  if (q.isError || !q.data) {
    return (
      <section aria-labelledby="sched-h" className="rounded-xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-4">
        <h2 id="sched-h" className="mb-3 font-semibold">Scheduled delivery</h2>
        <DataUnavailable
          title="Schedule state unavailable"
          reason={
            q.error instanceof Error
              ? q.error.message
              : "The intelligence service did not respond. Schedule state is unknown — it is not being reported as unscheduled."
          }
        />
      </section>
    );
  }

  const { schedule, featureFlag, deliveryMode, lastRun, nextRun, recipientCount, humanDecisions } = q.data;
  const configured = schedule.approved;

  return (
    <section aria-labelledby="sched-h" className="rounded-xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="sched-h" className="flex items-center gap-2 font-semibold">
          <CalendarClock className="h-4 w-4" aria-hidden />
          Scheduled delivery
        </h2>
        {/*
          The status is words, not a colour. "SCHEDULE NOT CONFIGURED" is the literal state the
          directive requires, and it is what a screen reader receives too.
        */}
        <span
          role="status"
          className={
            configured
              ? "rounded-md bg-[var(--color-biz-success)]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-success)]"
              : "rounded-md bg-[var(--color-biz-danger)]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-danger)]"
          }
        >
          {configured ? "Scheduled" : "Schedule not configured"}
        </span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {/* Each null renders as "Not set" — never as a default time, recurrence or zone. */}
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Time</dt>
          <dd>{renderScheduleField(schedule.localTime)}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Recurrence</dt>
          <dd>{renderScheduleField(schedule.recurrence)}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Timezone</dt>
          <dd>{renderScheduleField(schedule.timezoneStrategy)}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Delivery mode</dt>
          <dd>{deliveryMode}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Feature flag</dt>
          <dd>{featureFlag.enabled ? "Enabled" : "Off"}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Recipients if enabled</dt>
          <dd>{recipientCount}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Last run</dt>
          <dd>{lastRun?.at ? new Date(lastRun.at).toLocaleString() : "Never run"}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
          <dt className="text-[var(--color-biz-muted)]">Next run</dt>
          <dd>{nextRun?.at ? new Date(nextRun.at).toLocaleString() : "None scheduled"}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-[var(--color-biz-muted)]">
        Deliveries run in {deliveryMode} mode: the platform rehearses the full governance decision —
        template, recipient, quiet hours, cooldown and channel — without sending. Enabling delivery
        requires an approved schedule and an enabled feature flag.
      </p>

      {humanDecisions.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
            Awaiting a human decision
          </h3>
          <ul className="mt-1.5 space-y-1">
            {humanDecisions.map((d) => (
              <li key={d} className="flex items-start gap-2 text-[11px] text-[var(--color-biz-muted)]">
                <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
});
