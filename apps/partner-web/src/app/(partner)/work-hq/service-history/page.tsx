"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerBookingsQuery } from "@/hooks/use-partner-data";
import { usePartnerServiceHistoryQuery } from "@/hooks/use-partner-os";
import { cn } from "@/lib/cn";
import { formatInr } from "@/lib/format";

type Tab = "all" | "completed" | "cancelled" | "upcoming";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All recent" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "upcoming", label: "Upcoming" },
];

function matchesTab(status: string, tab: Tab) {
  const s = status.toLowerCase();
  if (tab === "all") return true;
  if (tab === "completed") return s === "completed";
  if (tab === "cancelled") return s.startsWith("cancelled");
  if (tab === "upcoming") return ["pending", "accepted", "assigned", "en_route", "in_progress"].includes(s);
  return true;
}

export default function ServiceHistoryPage() {
  const [tab, setTab] = useState<Tab>("all");
  const history = usePartnerServiceHistoryQuery();
  const bookings = usePartnerBookingsQuery({ page: 1, limit: 50, sortBy: "recent" });
  const data = history.data;

  const rows = useMemo(
    () => (bookings.data?.bookings ?? []).filter((b) => matchesTab(b.status, tab)),
    [bookings.data?.bookings, tab],
  );

  return (
    <HqPageShell
      title="Service History"
      description="Lifecycle counts from service-history API plus recent booking records from your jobs feed."
      icon={FileText}
      stats={[
        { label: "Completed", value: data?.completed ?? 0 },
        { label: "Cancelled", value: data?.cancelled ?? 0 },
        { label: "Rescheduled", value: data?.rescheduled ?? 0 },
        { label: "Upcoming", value: data?.upcoming ?? 0 },
      ]}
    >
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              tab === id
                ? "border-partner-primary bg-partner-primary/10 text-partner-primary"
                : "border-partner-line text-partner-muted hover:border-partner-primary/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {bookings.isLoading ? (
          <div className="partner-card p-6 text-center text-sm text-partner-muted">Loading bookings…</div>
        ) : rows.length === 0 ? (
          <div className="partner-card p-6 text-center text-sm text-partner-muted">No bookings in this filter.</div>
        ) : (
          rows.map((b) => (
            <article key={b.id} className="partner-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{b.service?.name ?? "Service"}</p>
                <p className="text-xs text-partner-muted">
                  {b.bookingNumber ?? b.id.slice(0, 8)} · {b.status}
                </p>
                <p className="mt-1 text-xs text-partner-muted-dim">
                  {b.scheduledDate
                    ? new Date(b.scheduledDate).toLocaleString("en-IN")
                    : b.completedAt
                      ? new Date(b.completedAt).toLocaleString("en-IN")
                      : "—"}
                </p>
              </div>
              <p className="text-sm font-bold text-partner-primary">{formatInr(b.finalAmount ?? b.amount)}</p>
            </article>
          ))
        )}
      </div>
    </HqPageShell>
  );
}
