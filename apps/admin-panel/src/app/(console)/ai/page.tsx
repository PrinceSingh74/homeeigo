"use client";

import { Bot, Brain, ShieldCheck, Sparkles } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { formatNumber } from "@/lib/format";

const SYSTEMS = [
  {
    name: "Smart vendor matching",
    description:
      "Ranks providers by proximity, rating, completion rate and acceptance velocity for each incoming booking.",
    icon: Brain,
    endpoint: "matching.service",
  },
  {
    name: "Booking validation engine",
    description:
      "Detects overlapping bookings, blackout windows, and unrealistic service durations before charging the customer.",
    icon: ShieldCheck,
    endpoint: "booking-validation.service",
  },
  {
    name: "Customer AI assistant",
    description:
      "Powers the conversational booking flow on homigo.com — service triage, scheduling, FAQs, photo diagnosis.",
    icon: Sparkles,
    endpoint: "/ai (web)",
  },
  {
    name: "Partner AI co-pilot",
    description:
      "Helps providers prioritise jobs, draft messages, and surface upcoming earnings forecasts.",
    icon: Bot,
    endpoint: "/ai (partner)",
  },
];

export default function AiSystemsPage() {
  const dashboard = useAdminDashboardQuery();
  const stats = dashboard.data?.stats;
  const bookings = stats?.totalBookings ?? 0;
  const providers = stats?.totalProviders ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI systems</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Matching, validation, KYC, customer &amp; vendor assistants
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total bookings routed"
          value={dashboard.isLoading ? "—" : formatNumber(bookings)}
          icon={Brain}
        />
        <KpiCard
          label="Providers in matching pool"
          value={dashboard.isLoading ? "—" : formatNumber(providers)}
          icon={Bot}
          accent="green"
        />
        <KpiCard
          label="Live providers"
          value={dashboard.isLoading ? "—" : formatNumber(stats?.activeNow ?? 0)}
          icon={ShieldCheck}
          accent="amber"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SYSTEMS.map((s) => (
          <div key={s.name} className="biz-card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]">
                <s.icon className="h-5 w-5" />
              </span>
              <span className="font-mono text-[10px] text-[var(--color-biz-muted)]">
                {s.endpoint}
              </span>
            </div>
            <p className="text-sm font-semibold">{s.name}</p>
            <p className="text-xs leading-relaxed text-[var(--color-biz-muted)]">
              {s.description}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[var(--color-biz-muted)]">
        Dedicated AI metrics (jobs processed, model latency, classification accuracy) will
        appear here once the backend exposes the AI telemetry endpoints. Today this page
        reflects live backend counts from <code>/api/admin/dashboard</code>.
      </p>
    </div>
  );
}
