"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerApi } from "@/services/partner-api";
import { partnerKeys, usePartnerOperationsQuery } from "@/hooks/use-partner-data";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AvailabilityScheduleForm() {
  const ops = usePartnerOperationsQuery();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.showToast);
  const [days, setDays] = useState<string[]>(DAYS.slice(0, 5));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [breakStart, setBreakStart] = useState("13:00");
  const [breakEnd, setBreakEnd] = useState("14:00");
  const [hasBreak, setHasBreak] = useState(true);
  const [maxDay, setMaxDay] = useState(5);
  const [maxConcurrent, setMaxConcurrent] = useState(2);

  useEffect(() => {
    const d = ops.data;
    if (!d) return;
    setDays(d.workingDays.length ? d.workingDays : DAYS.slice(0, 5));
    setStart(d.workingHoursStart ?? "09:00");
    setEnd(d.workingHoursEnd ?? "18:00");
    const b = d.breakWindows[0];
    setHasBreak(Boolean(b));
    setBreakStart(b?.start ?? "13:00");
    setBreakEnd(b?.end ?? "14:00");
    setMaxDay(d.maxJobsPerDay ?? 5);
    setMaxConcurrent(d.maxConcurrentJobs ?? 2);
  }, [ops.data]);

  const save = useMutation({
    mutationFn: () =>
      partnerApi.updateSettings({
        workingDays: days,
        workingHoursStart: start,
        workingHoursEnd: end,
        breakWindows: hasBreak ? [{ start: breakStart, end: breakEnd }] : [],
        maxJobsPerDay: maxDay,
        maxConcurrentJobs: maxConcurrent,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.operations });
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
      toast("Schedule saved", "success");
    },
    onError: (e) => toast(getErrorMessage(e), "error"),
  });

  if (ops.isLoading) {
    return (
      <PartnerCard>
        <p className="text-sm text-partner-muted">Loading availability…</p>
      </PartnerCard>
    );
  }

  if (!ops.data?.workingDays.length && !ops.isLoading) {
    /* empty handled inline below */
  }

  return (
    <PartnerCard className="space-y-8">
      <div>
        <h2 className="font-display text-lg font-semibold">Working days</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={`${d}${on ? ", selected" : ""}`}
                className={cn(
                  "min-h-11 min-w-11 rounded-full border px-3 text-sm font-semibold",
                  on
                    ? "border-partner-primary bg-partner-primary/10 text-partner-primary"
                    : "border-partner-line text-partner-muted",
                )}
                onClick={() => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
              >
                {d[0]}
              </button>
            );
          })}
        </div>
        {days.length === 0 ? <p className="mt-2 text-sm text-partner-warning">Set your working days and hours.</p> : null}
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Working hours</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <label className="text-sm">
            <span className="text-partner-muted">Start</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-transparent px-3" />
          </label>
          <span className="hidden pb-3 text-partner-muted sm:block">—</span>
          <label className="text-sm">
            <span className="text-partner-muted">End</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-transparent px-3" />
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Break</h2>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={hasBreak} onChange={(e) => setHasBreak(e.target.checked)} />
            Scheduled break
          </label>
        </div>
        {hasBreak ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} className="min-h-11 rounded-xl border border-partner-line bg-transparent px-3" aria-label="Break start" />
            <span className="hidden pb-3 text-partner-muted sm:block">—</span>
            <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} className="min-h-11 rounded-xl border border-partner-line bg-transparent px-3" aria-label="Break end" />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-partner-muted">Max jobs / day</span>
          <input type="number" min={1} max={50} value={maxDay} onChange={(e) => setMaxDay(Number(e.target.value))} className="mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-transparent px-3" />
        </label>
        <label className="text-sm">
          <span className="text-partner-muted">Max concurrent</span>
          <input type="number" min={1} max={20} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} className="mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-transparent px-3" />
        </label>
      </div>

      <PartnerButton className="min-h-11 w-full sm:w-auto" onClick={() => save.mutate()} disabled={save.isPending || days.length === 0}>
        {save.isPending ? "Saving…" : "Save changes"}
      </PartnerButton>
    </PartnerCard>
  );
}
