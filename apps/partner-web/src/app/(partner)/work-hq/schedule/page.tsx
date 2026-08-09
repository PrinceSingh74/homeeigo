"use client";

import { Calendar } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerBookingsQuery, usePartnerMeQuery } from "@/hooks/use-partner-data";
import { OnlineToggle } from "@/components/availability/OnlineToggle";

export default function SchedulePage() {
  const me = usePartnerMeQuery();
  const upcoming = usePartnerBookingsQuery({ page: 1, limit: 15, sortBy: "upcoming" });
  const rows = (upcoming.data?.bookings ?? []).filter((b) =>
    ["pending", "accepted", "assigned", "en_route", "in_progress"].includes(b.status),
  );

  return (
    <HqPageShell
      title="Schedule Center"
      description="Availability, shift planner, and upcoming jobs from live provider data."
      icon={Calendar}
      stats={[
        { label: "Availability", value: me.data?.isOnline ? "Online" : "Offline" },
        {
          label: "Shift window",
          value: `${me.data?.workingHoursStart ?? "--:--"} – ${me.data?.workingHoursEnd ?? "--:--"}`,
        },
        { label: "Upcoming jobs", value: rows.length },
        { label: "Working days", value: me.data?.workingDays?.length ?? 0 },
      ]}
    >
      <OnlineToggle />
      <section className="partner-card p-4">
        <h2 className="font-semibold">Upcoming jobs</h2>
        <div className="mt-3 space-y-2">
          {rows.map((job) => (
            <article key={job.id} className="rounded-lg border border-partner-line px-3 py-2 text-sm">
              <p className="font-medium">{job.service.name}</p>
              <p className="text-partner-muted">{new Date(job.scheduledDate).toLocaleString("en-IN")}</p>
            </article>
          ))}
        </div>
      </section>
    </HqPageShell>
  );
}
