"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Ban,
  CalendarCheck,
  Coins,
  Copy,
  Crown,
  FilterX,
  Fingerprint,
  IdCard,
  LifeBuoy,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Smile,
  Sparkles,
  Ticket,
  TrendingDown,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import {
  useAdminCustomersQuery,
  useAdminDashboardQuery,
  useBanUserMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import { adminApi } from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import type { AdminCustomer } from "@/types/admin";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "banned";
type KycFilter = "all" | "pending" | "verified" | "rejected";
type SortKey = "recent" | "spend" | "bookings";
type ConfirmAction = "ban" | "unban" | "logout";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/membership", label: "Membership" },
  { href: "/reviews", label: "Reviews" },
  { href: "/support", label: "Support" },
] as const;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function rows(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" && v.trim() ? v : d;
}

function customerName(u: Pick<AdminCustomer, "firstName" | "lastName" | "email">) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email || "Customer";
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

function daysLeft(iso: unknown) {
  if (!iso) return "expiring";
  const d = Math.ceil((new Date(String(iso)).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(d)) return "expiring";
  if (d <= 0) return "expires today";
  if (d === 1) return "1 day left";
  return `${d} days left`;
}

function relActivity(iso?: string | null) {
  if (!iso) return "no activity";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d) || d < 0) return formatDate(iso);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return formatDate(iso);
}

function npsTone(score: number | null): Icon3DTone {
  if (score == null) return "default";
  if (score >= 30) return "success";
  if (score >= 0) return "warning";
  return "danger";
}

function kycPending(status?: string) {
  return ["pending", "not_started", "in_review"].includes((status || "").toLowerCase());
}

function customerBrief(input: {
  total: number;
  banned: number;
  nps: number | null;
  csat: number | null;
  repeat: number | null;
  tickets: number;
  churnN: number;
  pendingKyc: number;
}) {
  const { total, banned, nps, csat, repeat, tickets, churnN, pendingKyc } = input;

  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The customer ledger is live, but nobody has registered yet. Empty is a new network — not a broken page.",
      impact: "NPS, CSAT, VIP, and expiry have nothing to rank until the first account books a job.",
      action: "Keep Marketplace HQ publishing. The first customers will land here automatically.",
    };
  }
  if (banned >= 5 || (nps != null && nps < 0)) {
    return {
      state: "critical" as const,
      label: "Trust pressure",
      meaning:
        nps != null && nps < 0
          ? `NPS is ${nps}. Detractors are louder than promoters on the last 30 days.`
          : `${banned} banned accounts sit on the ledger. Access control is carrying load.`,
      impact: `${formatNumber(total)} customers · ${tickets} tickets · repeat ${repeat ?? 0}%.`,
      action: nps != null && nps < 0 ? "Open reviews and support. Do not scale acquisition on a negative NPS." : "Inspect banned accounts. Force-logout if sessions are still live.",
    };
  }
  if (churnN > 0 || pendingKyc > 0 || tickets >= 10 || (csat != null && csat < 70)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        churnN > 0
          ? `${churnN} members expire within 7 days. That list is membership expiry — not a guessed churn model.`
          : csat != null && csat < 70
            ? `CSAT is ${csat}%. Catalog trust is below the 70% bar.`
            : pendingKyc > 0
              ? `${pendingKyc} customers on this page still have KYC open.`
              : `${tickets} support tickets in the CX window.`,
      impact: `${formatNumber(total)} on the ledger · NPS ${nps ?? "—"} · ${banned} banned.`,
      action: churnN > 0 ? "Reach expiring members from Membership before the window closes." : "Clear KYC, tickets, or the CSAT gap before pushing campaigns.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "The customer base is in range. Trust, repeat, and access control are not the constraint.",
    impact: `${formatNumber(total)} customers · NPS ${nps ?? "—"} · repeat ${repeat ?? 0}%.`,
    action: "Keep Document Review and Membership expiry clean. No customer-ledger action required.",
  };
}

function PersonMini({
  name,
  email,
  meta,
  value,
  tone = "accent",
  onOpen,
}: {
  name: string;
  email?: string;
  meta?: string;
  value: string;
  tone?: "accent" | "danger";
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="cu-avatar" aria-hidden>
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
          {[email, meta].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-bold tabular-nums",
          tone === "danger" ? "text-[var(--color-biz-danger)]" : "text-[var(--color-biz-accent)]",
        )}
      >
        {value}
      </span>
    </>
  );

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className="cu-person cu-person--btn">
        {inner}
      </button>
    );
  }
  return <div className="cu-person">{inner}</div>;
}

function EmptyLane({
  icon: Icon,
  tone = "cyan",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof Users;
  tone?: Icon3DTone;
  title: string;
  reason: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="cu-empty">
      <Icon3D icon={Icon} size="md" tone={tone} />
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-[var(--color-biz-muted)]">{reason}</p>
      {href && cta ? (
        <Link href={href} className="biz-btn biz-btn-primary mt-1 text-xs [&_svg]:text-white">
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

const INSPECT_GUIDE = [
  { icon: Fingerprint, tone: "cyan" as const, title: "Identity", copy: "KYC, city, and last seen" },
  { icon: Wallet, tone: "default" as const, title: "Spend", copy: "Lifetime spend, wallet, referrals" },
  { icon: CalendarCheck, tone: "success" as const, title: "Bookings", copy: "Completed jobs and jump to bookings" },
  { icon: ShieldCheck, tone: "warning" as const, title: "Access", copy: "Force logout, ban, unban" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={IdCard} tone="cyan" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Customer file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a ledger name — or use ↑ ↓ — to open identity, spend, and access control.
            </p>
          </div>
        </div>
      </div>

      <div className="cu-dock__body">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected customer</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The ledger is empty — new accounts land on the left first"}
            </p>
          </div>
        </div>

        <div className="cu-dock__stats">
          {[
            ["Spent", "—"],
            ["Bookings", "—"],
            ["Wallet", "—"],
            ["Referrals", "—"],
          ].map(([label, value]) => (
            <div key={label} className="cu-stat cu-stat--ghost">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>

        <div className="cu-guide">
          <p className="cu-intel__label">What opens here</p>
          <ul>
            {INSPECT_GUIDE.map((item) => (
              <li key={item.title}>
                <Icon3D icon={item.icon} tone={item.tone} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight">{item.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-biz-muted)]">{item.copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="cu-dock__actions">
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cu-filter">
      <span className="cu-filter__label">{label}</span>
      <div className="cu-filter__row">{children}</div>
    </div>
  );
}

export default function CustomersPage() {
  const secondary = useAfterFirstPaint();
  const dashboard = useAdminDashboardQuery({ enabled: secondary });
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : "",
  );
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kycFilter, setKycFilter] = useState<KycFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"id" | "email" | null>(null);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      kyc: kycFilter === "all" ? undefined : kycFilter,
      sort: sort === "recent" ? undefined : sort,
    }),
    [debouncedSearch, kycFilter, page, sort, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminCustomersQuery(params);
  const bannedQ = useAdminCustomersQuery(
    { page: 1, limit: 1, status: "banned", badge: true },
    { enabled: secondary },
  );
  const banMutation = useBanUserMutation();
  const logoutMutation = useMutation({
    mutationFn: (vars: { userId: string; reason?: string }) => adminApi.forceLogoutUser(vars.userId, vars.reason),
  });

  const cxQ = useQuery({
    queryKey: ["hq", "customers", "cx"],
    queryFn: () => adminApi.cxIntelligence(30),
    staleTime: 120_000,
    enabled: secondary,
  });
  const kpisQ = useQuery({
    queryKey: ["hq", "customers", "exec-kpis"],
    queryFn: () => adminApi.geoIntel.execKpis(),
    staleTime: 60_000,
    enabled: secondary,
  });
  const growthQ = useQuery({
    queryKey: ["hq", "customers", "growth"],
    queryFn: () => adminApi.growthIntelligence(30),
    staleTime: 120_000,
    enabled: secondary,
  });
  const insightsQ = useQuery({
    queryKey: ["hq", "marketplace", "insights"],
    queryFn: () => adminApi.subscriptions.insights(),
    staleTime: 120_000,
    enabled: secondary,
  });
  const profileQ = useQuery({
    queryKey: ["customer-intel", selectedId],
    queryFn: () => adminApi.customerIntel.profile(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminCustomer; action: ConfirmAction } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const users = data?.users ?? [];
  const selected = users.find((u) => u.id === selectedId) ?? null;
  const filtersOn = Boolean(debouncedSearch) || statusFilter !== "all" || kycFilter !== "all" || sort !== "recent";

  useEffect(() => {
    if (selectedId && !users.some((u) => u.id === selectedId) && !isFetching) {
      setSelectedId(null);
    }
  }, [isFetching, selectedId, users]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (typing) {
          (el as HTMLInputElement).blur();
          return;
        }
        setSelectedId(null);
        return;
      }
      if (typing || users.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? users.findIndex((u) => u.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(users.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(users[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, users]);

  const totalCustomers = dashboard.data?.stats.totalUsers ?? data?.total ?? 0;
  const bannedTotal = bannedQ.data?.total ?? 0;
  const cx = cxQ.data;
  const nps = cx?.nps.score ?? null;
  const csat = cx?.csat.scorePct ?? null;
  const happiness = cx?.customerHappinessScore ?? null;
  const repeat = cx?.components.repeatCustomerRatePct ?? null;
  const tickets = cx?.components.ticketsCount ?? 0;
  const activeNow = kpisQ.data?.data.activeCustomers ?? 0;
  const newCustomers = growthQ.data?.newCustomers ?? 0;
  const ltv = growthQ.data?.ltv ?? 0;

  const ins = rec(insightsQ.data);
  const vip = rows(ins.highValueMembers);
  const churnRisk = rows(ins.churnRiskUsers);
  const upgrades = rows(ins.upgradeRecommendations);

  const pendingKycOnPage = users.filter((u) => kycPending(u.kycStatus)).length;

  const brief = customerBrief({
    total: totalCustomers,
    banned: bannedTotal,
    nps,
    csat,
    repeat,
    tickets,
    churnN: churnRisk.length,
    pendingKyc: pendingKycOnPage,
  });

  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const complaintSeries = useMemo(
    () => (cx?.complaintTrend ?? []).slice(-14).map((d) => ({ label: d.date.slice(5), value: d.count })),
    [cx?.complaintTrend],
  );

  const pageSpend = users.reduce((s, u) => s + (u.totalSpent || 0), 0);

  const rawProfile = rec(profileQ.data);
  const profile = Object.keys(rec(rawProfile.data)).length ? rec(rawProfile.data) : rawProfile;

  const fetching =
    isFetching || cxQ.isFetching || insightsQ.isFetching || kpisQ.isFetching || growthQ.isFetching || dashboard.isFetching;

  const refresh = () => {
    void refetch();
    void bannedQ.refetch();
    void cxQ.refetch();
    void kpisQ.refetch();
    void growthQ.refetch();
    void insightsQ.refetch();
    if (selectedId) void profileQ.refetch();
  };

  const copyText = async (value: string, kind: "id" | "email") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* ignore */
    }
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setKycFilter("all");
    setSort("recent");
    setPage(1);
  };

  const openFromList = (email?: string, userId?: string) => {
    if (email) setSearch(email);
    setStatusFilter("all");
    setKycFilter("all");
    setSort("recent");
    setPage(1);
    if (userId) setSelectedId(userId);
  };

  const completed = num(profile.completedBookings);
  const jobShare = selected && selected.totalBookings > 0 ? Math.round((completed / selected.totalBookings) * 100) : 0;

  return (
    <div className="exec-hq cu-page mx-auto max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Users} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Customer Ledger</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Live base
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Identity, spend, KYC, and access control for every homigo.com account — inspect one file at a time.
              </p>
            </div>
          </div>
          <button type="button" onClick={refresh} className="biz-btn shrink-0">
            <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="cu-brief">
          <article>
            <h3>Meaning</h3>
            <p>{brief.meaning}</p>
          </article>
          <article>
            <h3>Impact</h3>
            <p>{brief.impact}</p>
          </article>
          <article>
            <h3>Action</h3>
            <p>{brief.action}</p>
          </article>
        </div>

        <div className="cu-jumps">
          {JUMPS.map((j) => (
            <Link key={j.href} href={j.href} className="cu-jump">
              {j.label}
              <ArrowUpRight size={12} />
            </Link>
          ))}
        </div>
      </header>

      <section className="cu-kpi">
        <StatTile
          label="Customers"
          value={formatNumber(totalCustomers)}
          sub={activeNow ? `${formatNumber(activeNow)} active now` : "registered ledger"}
          icon={Users}
          loading={dashboard.isLoading}
        />
        <StatTile
          label="Trust"
          value={nps == null ? "—" : String(Math.round(nps))}
          sub={csat == null ? "NPS · 30-day window" : `NPS · CSAT ${Math.round(csat)}%`}
          icon={Smile}
          loading={cxQ.isLoading}
          tone={nps == null ? "default" : nps >= 30 ? "success" : nps >= 0 ? "accent" : "danger"}
        />
        <StatTile
          label="Access"
          value={formatNumber(bannedTotal)}
          sub={pendingKycOnPage > 0 ? `${pendingKycOnPage} KYC open on this page` : bannedTotal > 0 ? "banned on the ledger" : "none banned"}
          icon={Ban}
          loading={bannedQ.isLoading}
          tone={bannedTotal > 0 ? "danger" : "success"}
        />
        <StatTile
          label="New · 30d"
          value={formatNumber(newCustomers)}
          sub={ltv > 0 ? `avg LTV ${inr(ltv, true)}` : "growth intelligence"}
          icon={Sparkles}
          loading={growthQ.isLoading}
          tone={newCustomers > 0 ? "accent" : "default"}
        />
      </section>

      {(bannedTotal > 0 || pendingKycOnPage > 0 || tickets > 0 || churnRisk.length > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {pendingKycOnPage > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", kycFilter === "pending" && "is-on")}
              onClick={() => {
                setKycFilter("pending");
                setStatusFilter("all");
                setPage(1);
              }}
            >
              <IdCard size={14} />
              {pendingKycOnPage} KYC open
            </button>
          ) : null}
          {bannedTotal > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-hot", statusFilter === "banned" && "is-on")}
              onClick={() => {
                setStatusFilter("banned");
                setKycFilter("all");
                setPage(1);
              }}
            >
              <Ban size={14} />
              {formatNumber(bannedTotal)} banned
            </button>
          ) : null}
          {tickets > 0 ? (
            <Link href="/support" className="cu-rail__chip">
              <Ticket size={14} />
              {formatNumber(tickets)} tickets
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {churnRisk.length > 0 ? (
            <a href="#cu-floor" className="cu-rail__chip is-warm">
              <TrendingDown size={14} />
              {churnRisk.length} expiring
            </a>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Ledger</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {isLoading ? "Loading…" : `${formatNumber(data?.total ?? 0)} matching`}
                  {pageSpend > 0 ? ` · ${inr(pageSpend, true)} on this page` : ""}
                </p>
              </div>
              {filtersOn ? (
                <button type="button" className="biz-btn !px-2.5 text-xs" onClick={clearFilters}>
                  <FilterX size={13} />
                  Clear
                </button>
              ) : null}
            </div>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-muted)]" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                placeholder="Search name or email…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Status">
                {(["all", "active", "banned"] as const).map((s) => (
                  <button type="button" key={s} onClick={() => { setPage(1); setStatusFilter(s); }} className={cn("cu-chip", statusFilter === s && "is-on")}>
                    {s}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="KYC">
                {(["all", "pending", "verified", "rejected"] as const).map((k) => (
                  <button type="button" key={k} onClick={() => { setPage(1); setKycFilter(k); }} className={cn("cu-chip", kycFilter === k && "is-on")}>
                    {k}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                {([
                  ["recent", "Joined"],
                  ["spend", "Spend"],
                  ["bookings", "Bookings"],
                ] as const).map(([key, label]) => (
                  <button type="button" key={key} onClick={() => { setPage(1); setSort(key); }} className={cn("cu-chip", sort === key && "is-on")}>
                    {label}
                  </button>
                ))}
              </FilterGroup>
            </div>
          </div>

          {mutationError ? <div className="cu-alert">{mutationError}</div> : null}

          <div className="cu-ledger__body">
            {isFetching && !isLoading ? <div className="cu-updating">Updating…</div> : null}

            {isLoading ? (
              <div className="cu-list">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="biz-skeleton h-[4.75rem] rounded-2xl" />
                ))}
              </div>
            ) : isError ? (
              <div className="cu-empty-wrap">
                <p className="text-sm">Could not load the customer ledger.</p>
                <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : users.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Users}
                  title={filtersOn ? "No match" : "Ledger is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search and filters."
                      : "The first registered customer will appear here with spend, KYC, and activity."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {users.map((u) => {
                  const name = customerName(u);
                  const on = selectedId === u.id;
                  const banned = !u.isActive;
                  const pending = kycPending(u.kycStatus);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : u.id)}
                        className={cn("cu-row", on && "is-on", banned && "is-ban", pending && !banned && "is-kyc")}
                      >
                        <span className={cn("cu-avatar", banned && "cu-avatar--ban")} aria-hidden>
                          {initials(name)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[0.95rem] font-semibold tracking-tight">{name}</p>
                            <StatusBadge status={u.isActive ? "active" : "banned"} />
                            <StatusBadge status={(u.kycStatus || "pending").toLowerCase()} />
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{u.email}</span>
                            {u.preferredCity ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={11} />
                                {u.preferredCity}
                              </span>
                            ) : null}
                            <span>{relActivity(u.lastActivityAt)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p data-stat-value className="text-[0.95rem] font-bold tracking-tight">
                            {inr(u.totalSpent, true)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                            {formatNumber(u.totalBookings)} bookings
                            {(u.walletBalance ?? 0) > 0 ? ` · ${inr(u.walletBalance ?? 0, true)} wallet` : ""}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Pagination
            page={data?.page ?? page}
            total={data?.total ?? 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            isFetching={isFetching}
            className="cu-pager"
          />
        </div>

        <aside className={cn("cu-dock cu-panel", selected ? "is-open" : "is-idle")}>
          {selected ? (
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <span className={cn("cu-avatar cu-avatar--lg", !selected.isActive && "cu-avatar--ban")}>
                    {initials(customerName(selected))}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">Customer file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold tracking-tight">{customerName(selected)}</h2>
                      <StatusBadge status={selected.isActive ? "active" : "banned"} />
                    </div>
                    <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">{selected.email}</p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Last seen {relActivity(selected.lastActivityAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={(selected.kycStatus || "pending").toLowerCase()} />
                      {selected.preferredCity ? (
                        <span className="cu-chip is-on">
                          <MapPin size={11} />
                          {selected.preferredCity}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <button type="button" className="biz-btn !px-2.5" onClick={() => setSelectedId(null)} aria-label="Close inspect">
                  <X size={14} />
                </button>
              </div>

              <div className="cu-dock__body">
                <div className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Spent</dt>
                    <dd data-stat-value>{inr(selected.totalSpent, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Bookings</dt>
                    <dd data-stat-value>{formatNumber(selected.totalBookings)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Wallet</dt>
                    <dd data-stat-value>{inr(selected.walletBalance ?? 0, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Referrals</dt>
                    <dd data-stat-value>{formatNumber(selected.referralCount ?? 0)}</dd>
                  </div>
                </div>

                <div className="cu-intel">
                  <p className="cu-intel__label">Profile intel</p>
                  {profileQ.isLoading ? (
                    <div className="biz-skeleton mt-4 h-28 rounded-xl" />
                  ) : profileQ.isError ? (
                    <p className="mt-3 text-sm text-[var(--color-biz-muted)]">Intelligence unavailable for this account.</p>
                  ) : (
                    <>
                      <dl className="cu-intel__rows">
                        <div>
                          <dt>Completed jobs</dt>
                          <dd>{formatNumber(completed)}</dd>
                        </div>
                        <div>
                          <dt>Avg rating given</dt>
                          <dd>{profile.avgRatingGiven == null ? "—" : `${num(profile.avgRatingGiven).toFixed(1)}★`}</dd>
                        </div>
                        <div>
                          <dt>Tenure</dt>
                          <dd>{formatNumber(num(profile.tenureDays))}d</dd>
                        </div>
                        <div>
                          <dt>Joined</dt>
                          <dd>{formatDate(selected.createdAt)}</dd>
                        </div>
                      </dl>
                      {selected.totalBookings > 0 ? (
                        <div className="mt-4">
                          <MeterBar
                            label="Completed share"
                            value={jobShare}
                            tone={jobShare >= 70 ? "success" : jobShare >= 40 ? "accent" : "danger"}
                          />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="cu-jump-row">
                  <Link
                    href={`/bookings?q=${encodeURIComponent(selected.firstName || selected.email)}`}
                    className="biz-btn text-xs"
                  >
                    <CalendarCheck size={13} />
                    Bookings
                  </Link>
                  <Link href="/referrals" className="biz-btn text-xs">
                    <Users size={13} />
                    Referrals
                  </Link>
                  <Link href={`/support?q=${encodeURIComponent(selected.email)}`} className="biz-btn text-xs">
                    <LifeBuoy size={13} />
                    Support
                  </Link>
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyText(selected.email, "email")}>
                    <Copy size={13} />
                    {copied === "email" ? "Copied" : "Email"}
                  </button>
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyText(selected.id, "id")}>
                    <Copy size={13} />
                    {copied === "id" ? "Copied" : "ID"}
                  </button>
                </div>
              </div>

              <div className="cu-dock__actions">
                <button
                  type="button"
                  className="biz-btn w-full justify-center"
                  disabled={logoutMutation.isPending}
                  onClick={() => setConfirmTarget({ user: selected, action: "logout" })}
                >
                  <LogOut size={14} />
                  Force logout
                </button>
                <button
                  type="button"
                  className={cn(
                    "biz-btn w-full justify-center",
                    selected.isActive ? "text-[var(--color-biz-danger)]" : "text-[var(--color-biz-success)]",
                  )}
                  disabled={banMutation.isPending}
                  onClick={() => setConfirmTarget({ user: selected, action: selected.isActive ? "ban" : "unban" })}
                >
                  {selected.isActive ? <Ban size={14} /> : <ShieldCheck size={14} />}
                  {selected.isActive ? "Ban customer" : "Unban customer"}
                </button>
              </div>
            </div>
          ) : (
            <InspectIdle matching={data?.total ?? users.length} />
          )}
        </aside>
      </section>

      <section id="cu-floor" className="cu-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Smile}
            tone={npsTone(nps)}
            title="Experience"
            subtitle="30-day CX window — happiness, CSAT, repeat, complaints"
          />
          <div className="cu-trust">
            <MeterBar
              label="Happiness"
              value={happiness ?? 0}
              tone={happiness == null ? "accent" : happiness >= 60 ? "success" : "danger"}
            />
            <MeterBar
              label="CSAT"
              value={csat ?? 0}
              tone={csat == null ? "accent" : csat >= 70 ? "success" : "danger"}
            />
            <MeterBar
              label="Repeat"
              value={repeat ?? 0}
              tone={(repeat ?? 0) >= 25 ? "success" : "accent"}
            />
          </div>
          <div className="mt-6">
            <p className="cu-intel__label mb-3">Complaints · 14d</p>
            <IsoBarChart
              data={complaintSeries}
              format={formatNumber}
              accent="amber"
              layout="area"
              height={132}
              isLoading={cxQ.isLoading}
            />
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Crown}
            tone="warning"
            title="VIP / cashback"
            subtitle="Credited cashback, not guessed LTV"
            action={
              <Link href="/membership/cashback" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Cashback
              </Link>
            }
          />
          {insightsQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : vip.length > 0 ? (
            <div className="space-y-2">
              {vip.slice(0, 5).map((v, i) => (
                <PersonMini
                  key={str(v.userId, String(i))}
                  name={str(v.name, `Member ${i + 1}`)}
                  email={str(v.email)}
                  value={inr(num(v.totalCashback))}
                  onOpen={() => openFromList(str(v.email) || undefined, str(v.userId) || undefined)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Crown} tone="warning" title="No VIP ledger" reason="High-value members appear once cashback is credited." href="/membership" cta="Membership" />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={TrendingDown}
            tone="danger"
            title="Expiring members"
            subtitle="Plans ending within 7 days"
            action={
              <Link href="/membership" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Members
              </Link>
            }
          />
          {insightsQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : churnRisk.length > 0 ? (
            <div className="space-y-2">
              {churnRisk.slice(0, 5).map((c, i) => (
                <PersonMini
                  key={str(c.userId, String(i))}
                  name={str(c.name, `Member ${i + 1}`)}
                  email={str(c.plan)}
                  meta={daysLeft(c.expiresAt)}
                  value={daysLeft(c.expiresAt)}
                  tone="danger"
                  onOpen={() => openFromList(str(c.email) || undefined, str(c.userId) || undefined)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={TrendingDown} tone="danger" title="No expiry window" reason="Memberships expiring in 7 days will land here." href="/membership" cta="Members" />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Coins} tone="success" title="Upgrade opportunities" subtitle="High spend, no active plan" />
          {insightsQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : upgrades.length > 0 ? (
            <div className="space-y-2">
              {upgrades.slice(0, 5).map((u, i) => (
                <PersonMini
                  key={str(u.userId, String(i))}
                  name={str(u.name, `Customer ${i + 1}`)}
                  email={str(u.email)}
                  value={inr(num(u.totalSpent), true)}
                  onOpen={() => openFromList(str(u.email) || undefined, str(u.userId) || undefined)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Users} tone="success" title="No upgrade list" reason="Customers over ₹5,000 spend with no membership appear here." />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmTarget}
        title={
          confirmTarget?.action === "ban"
            ? "Ban this customer?"
            : confirmTarget?.action === "unban"
              ? "Unban this customer?"
              : "Force logout on all devices?"
        }
        description={
          confirmTarget
            ? confirmTarget.action === "ban"
              ? `${customerName(confirmTarget.user)} will lose access immediately and in-flight bookings will be cancelled.`
              : confirmTarget.action === "unban"
                ? `${customerName(confirmTarget.user)} will regain access to the platform.`
                : `${customerName(confirmTarget.user)} will be signed out of every device. Sessions will not resume until they log in again.`
            : undefined
        }
        confirmLabel={
          confirmTarget?.action === "ban" ? "Ban customer" : confirmTarget?.action === "unban" ? "Unban customer" : "Force logout"
        }
        destructive={confirmTarget?.action === "ban" || confirmTarget?.action === "logout"}
        reasonLabel={confirmTarget?.action === "unban" ? undefined : "Reason (ops only)"}
        reasonPlaceholder={confirmTarget?.action === "logout" ? "e.g. Stolen device report" : "e.g. Repeated chargebacks"}
        isLoading={banMutation.isPending || logoutMutation.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (reason) => {
          if (!confirmTarget) return;
          setMutationError(null);
          try {
            if (confirmTarget.action === "logout") {
              await logoutMutation.mutateAsync({ userId: confirmTarget.user.id, reason });
            } else {
              await banMutation.mutateAsync({
                userId: confirmTarget.user.id,
                action: confirmTarget.action,
                reason,
              });
            }
            setConfirmTarget(null);
          } catch (error) {
            setMutationError(getErrorMessage(error));
          }
        }}
      />
    </div>
  );
}
