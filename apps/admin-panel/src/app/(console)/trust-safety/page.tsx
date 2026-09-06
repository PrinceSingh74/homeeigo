"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, FileText } from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { adminApi } from "@/services/admin-api";

export default function TrustSafetyPage() {
  const overview = useQuery({
    queryKey: ["admin", "trust-safety", "overview"],
    queryFn: () => adminApi.trustSafety.overview(),
    refetchInterval: 30_000,
  });
  const d = overview.data;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trust & Safety</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compliance, partner risk, SOS, and safety incidents — live operational state, not scores without evidence.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Expiring documents" value={String(d?.expiring ?? "—")} icon={FileText} loading={overview.isLoading} />
        <StatTile label="Expired" value={String(d?.expired ?? "—")} icon={FileText} loading={overview.isLoading} tone={d && d.expired > 0 ? "danger" : "default"} />
        <StatTile label="Restricted partners" value={String(d?.restricted ?? "—")} icon={ShieldCheck} loading={overview.isLoading} />
        <StatTile label="Risk reviews" value={String(d?.riskReview ?? "—")} icon={AlertTriangle} loading={overview.isLoading} />
        <StatTile label="Open incidents" value={String(d?.openIncidents ?? "—")} icon={AlertTriangle} loading={overview.isLoading} />
        <StatTile label="Active SOS" value={String(d?.sosOpen ?? "—")} icon={AlertTriangle} loading={overview.isLoading} tone={d && d.sosOpen > 0 ? "danger" : "default"} />
      </section>
      <nav className="grid gap-3 sm:grid-cols-3">
        <Link href="/trust-safety/compliance" className="biz-glass-panel rounded-2xl p-4 text-sm font-semibold">
          Partner compliance
        </Link>
        <Link href="/trust-safety/risk" className="biz-glass-panel rounded-2xl p-4 text-sm font-semibold">
          Risk queue
        </Link>
        <Link href="/trust-safety/incidents" className="biz-glass-panel rounded-2xl p-4 text-sm font-semibold">
          Safety incidents
        </Link>
      </nav>
    </div>
  );
}
