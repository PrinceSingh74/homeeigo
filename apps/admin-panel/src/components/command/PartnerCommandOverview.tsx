"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  FileText,
  Radio,
  CalendarCheck,
  Wallet,
  Banknote,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Gift,
  Workflow,
} from "lucide-react";
import { adminApi, type CommandCenterOverview, type CommandTile } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

const TILES: Array<{
  key: Exclude<keyof CommandCenterOverview, "generatedAt">;
  label: string;
  href: string;
  icon: typeof Users;
  format: (tile: CommandTile<Record<string, number>>) => string;
  sub?: (tile: CommandTile<Record<string, number>>) => string;
}> = [
  {
    key: "partners",
    label: "Partners",
    href: "/vendors",
    icon: Users,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.total) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.active)} active · ${formatNumber(t.data.suspended)} suspended` : ""),
  },
  {
    key: "applications",
    label: "Applications",
    href: "/partner-acquisition/applications",
    icon: FileText,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.openLeads) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.pendingProviders)} pending providers` : ""),
  },
  {
    key: "availability",
    label: "Availability",
    href: "/availability",
    icon: Radio,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.online) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.available)} available` : ""),
  },
  {
    key: "jobs",
    label: "Jobs",
    href: "/bookings",
    icon: CalendarCheck,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.active) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.today)} created today` : ""),
  },
  {
    key: "earnings",
    label: "Earnings",
    href: "/earnings",
    icon: Wallet,
    format: (t) => (t.status === "ok" ? inr(t.data.todayNet) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.todayCount)} posted today` : ""),
  },
  {
    key: "payouts",
    label: "Payouts",
    href: "/finance/payouts",
    icon: Banknote,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.pending) : "—"),
    sub: () => "open withdrawals",
  },
  {
    key: "kyc",
    label: "KYC",
    href: "/kyc",
    icon: ShieldCheck,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.pendingDocs) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.expiring)} expiring` : ""),
  },
  {
    key: "risk",
    label: "Risk",
    href: "/trust-safety/risk",
    icon: ShieldAlert,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.review) : "—"),
    sub: () => "in review",
  },
  {
    key: "safety",
    label: "Safety",
    href: "/trust-safety/incidents",
    icon: AlertTriangle,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.openIncidents) : "—"),
    sub: (t) => (t.status === "ok" ? `${formatNumber(t.data.sosOpen)} SOS open` : ""),
  },
  {
    key: "referrals",
    label: "Referrals",
    href: "/referrals",
    icon: Gift,
    format: (t) => (t.status === "ok" ? formatNumber(t.data.pendingQualification) : "—"),
    sub: () => "pending qualification",
  },
  {
    key: "automation",
    label: "Automation",
    href: "/automation",
    icon: Workflow,
    format: (t) => (t.status === "ok" ? `${formatNumber(t.data.live)} LIVE` : "—"),
    sub: (t) =>
      t.status === "ok"
        ? `${formatNumber(t.data.shadow)} shadow · ${formatNumber(t.data.outboxPending)} outbox · ${formatNumber(t.data.dlq)} DLQ`
        : "",
  },
];

function tileState(tile: CommandTile<Record<string, number>> | undefined) {
  if (!tile) return { value: "—", sub: "Loading", tone: "muted" as const };
  if (tile.status === "unauthorized") return { value: "—", sub: "Not in this role", tone: "muted" as const };
  if (tile.status === "unavailable") return { value: "—", sub: "Insufficient data", tone: "warn" as const };
  return { value: "", sub: "", tone: "ok" as const };
}

export function PartnerCommandOverview() {
  const q = useQuery({
    queryKey: ["admin", "command-center", "overview"],
    queryFn: () => adminApi.commandCenterOverview(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  if (q.isError) {
    return (
      <div className="biz-glass-panel flex items-center justify-between gap-3 p-4" role="alert">
        <p className="text-sm text-[var(--color-biz-muted)]">Command Center overview unavailable.</p>
        <button type="button" className="biz-btn text-xs" onClick={() => void q.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-live="polite">
      {TILES.map((def) => {
        const raw = q.data?.[def.key] as CommandTile<Record<string, number>> | undefined;
        const state = tileState(raw);
        const Icon = def.icon;
        const value = raw?.status === "ok" ? def.format(raw) : state.value;
        const sub = raw?.status === "ok" ? (def.sub?.(raw) ?? "") : state.sub;
        return (
          <Link
            key={def.key}
            href={def.href}
            className="biz-glass-panel min-w-0 p-3 transition hover:border-[var(--color-biz-accent)]/40"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
              <Icon className="h-3 w-3" />
              {def.label}
            </p>
            <p
              data-stat-value
              className={cn(
                "mt-1 truncate text-lg font-bold tabular-nums",
                q.isLoading && "text-[var(--color-biz-faint)]",
              )}
            >
              {q.isLoading ? "—" : value}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-[var(--color-biz-faint)]">{q.isLoading ? "Loading" : sub}</p>
          </Link>
        );
      })}
    </div>
  );
}
