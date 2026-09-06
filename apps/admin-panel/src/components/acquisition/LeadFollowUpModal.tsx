"use client";

import { useEffect, useState } from "react";
import { GlassModal } from "@/components/acquisition/GlassModal";

type LeadFollowUpModalProps = {
  open: boolean;
  currentAt?: string | null;
  currentReason?: string | null;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (body: { nextFollowUpAt: string; followUpReason?: string }) => void;
};

function toLocalInputValue(iso?: string | null): string {
  if (!iso) {
    const d = new Date();
    d.setHours(d.getHours() + 2, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadFollowUpModal({
  open,
  currentAt,
  currentReason,
  isLoading,
  onClose,
  onConfirm,
}: LeadFollowUpModalProps) {
  const [when, setWhen] = useState(toLocalInputValue());
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setWhen(toLocalInputValue(currentAt));
      setReason(currentReason ?? "");
    }
  }, [open, currentAt, currentReason]);

  const presets = [
    { label: "In 2 hours", hours: 2 },
    { label: "Today 5 PM", hours: null as number | null, hour: 17 },
    { label: "Tomorrow 10 AM", hours: null as number | null, tomorrow: true, hour: 10 },
  ];

  return (
    <GlassModal
      open={open}
      title="Schedule follow-up"
      subtitle="Set the next touchpoint for this lead."
      onClose={onClose}
      isLoading={isLoading}
      footer={
        <>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!when || isLoading}
            onClick={() =>
              onConfirm({
                nextFollowUpAt: new Date(when).toISOString(),
                followUpReason: reason.trim() || undefined,
              })
            }
            className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isLoading ? "Saving…" : "Schedule"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                const d = new Date();
                if (p.hours != null) d.setHours(d.getHours() + p.hours);
                else if (p.tomorrow) {
                  d.setDate(d.getDate() + 1);
                  d.setHours(p.hour ?? 10, 0, 0, 0);
                } else {
                  d.setHours(p.hour ?? 17, 0, 0, 0);
                }
                setWhen(toLocalInputValue(d.toISOString()));
              }}
              className="rounded-full border border-[var(--color-biz-line)] px-3 py-1 text-xs font-semibold text-[var(--color-biz-muted)] hover:border-[var(--color-biz-accent)] hover:text-[var(--color-biz-accent)]"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Date & time
          </label>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--color-biz-accent)] focus:ring-2"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Follow-up reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Confirm skill interest, share onboarding link…"
            className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--color-biz-accent)] focus:ring-2"
          />
        </div>
      </div>
    </GlassModal>
  );
}
