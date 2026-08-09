"use client";

import Link from "next/link";
import { usePartnerDashboardQuery, usePartnerMeQuery } from "@/hooks/use-partner-data";

const HOURS_MS = 1000 * 60 * 60;

export default function WorkHqPage() {
  const dashboard = usePartnerDashboardQuery();
  const me = usePartnerMeQuery();

  const onlineHours = me.data?.onlineSince
    ? Math.max(0, (Date.now() - new Date(me.data.onlineSince).getTime()) / HOURS_MS)
    : 0;

  const cards = [
    { label: "Live requests", value: dashboard.data?.counts.pendingRequests ?? 0 },
    { label: "Active jobs", value: dashboard.data?.counts.activeBookings ?? 0 },
    { label: "Completed today", value: dashboard.data?.counts.completedToday ?? 0 },
    { label: "Working hours (session)", value: `${onlineHours.toFixed(1)}h` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Work HQ</h1>
        <p className="text-sm text-partner-muted">
          Requests, bookings, attendance, and shift controls connected to live partner APIs.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="partner-card p-4">
            <p className="text-xs uppercase tracking-wide text-partner-muted">{card.label}</p>
            <p className="mt-2 font-display text-2xl font-bold">{card.value}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Link href="/work-hq/attendance" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Attendance Center</p>
          <p className="mt-1 text-sm text-partner-muted">Check-in/out trends and weekly/monthly attendance.</p>
        </Link>
        <Link href="/work-hq/schedule" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Schedule Center</p>
          <p className="mt-1 text-sm text-partner-muted">Availability, working days, and upcoming jobs.</p>
        </Link>
        <Link href="/work-hq/service-history" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Service History</p>
          <p className="mt-1 text-sm text-partner-muted">Completed, cancelled, rescheduled, and upcoming work mix.</p>
        </Link>
      </div>
    </div>
  );
}
