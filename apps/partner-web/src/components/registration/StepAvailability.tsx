"use client";

import { useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function StepAvailability({
  loading,
  initialValues,
  onSubmit,
}: {
  loading: boolean;
  initialValues?: { workingHoursStart?: string; workingHoursEnd?: string; workingDays?: string[] };
  onSubmit: (data: { workingHoursStart: string; workingHoursEnd: string; workingDays: string[] }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const workingDays = DAYS.filter((d) => fd.get(`day-${d}`) === "on");
        if (workingDays.length === 0) {
          setError("Select at least one working day.");
          return;
        }
        setError(null);
        onSubmit({
          workingHoursStart: String(fd.get("workingHoursStart") ?? "09:00"),
          workingHoursEnd: String(fd.get("workingHoursEnd") ?? "18:00"),
          workingDays,
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Availability</h2>
        <p className="text-sm text-partner-muted">Set your preferred working schedule.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Start time</span>
          <input
            name="workingHoursStart"
            type="time"
            defaultValue={initialValues?.workingHoursStart ?? "09:00"}
            className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">End time</span>
          <input
            name="workingHoursEnd"
            type="time"
            defaultValue={initialValues?.workingHoursEnd ?? "18:00"}
            className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label
              key={d}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-partner-border px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                name={`day-${d}`}
                defaultChecked={
                  initialValues?.workingDays
                    ? initialValues.workingDays.includes(d)
                    : d !== "Sun"
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-partner-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full min-h-11 rounded-xl bg-partner-primary py-3 font-semibold text-white disabled:opacity-60"
      >
        {loading ? "Saving…" : "Save & Continue"}
      </button>
    </form>
  );
}
