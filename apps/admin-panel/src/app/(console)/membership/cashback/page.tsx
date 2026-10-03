"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Coins,
  Copy,
  Crown,
  FilterX,
  Gift,
  Landmark,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  adminApi,
  type AdminCashbackReportRow,
} from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { AdminApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "pending" | "credited" | "reversed" | "redeemed";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/membership", label: "Membership" },
  { href: "/customers", label: "Customers" },
  { href: "/bookings", label: "Bookings" },
  { href: "/finance/liabilities", label: "Liabilities" },
  { href: "/membership/coupons", label: "Coupons" },
] as const;

const STATUS_LANES: Array<[StatusFilter, string]> = [
  ["all", "All"],
  ["pending", "Pending"],
  ["credited", "Credited"],
  ["reversed", "Reversed"],
  ["redeemed", "Redeemed"],
];

function skipForbidden(failureCount: number, error: unknown) {
  if (error instanceof AdminApiError && (error.status === 403 || error.status === 401)) return false;
  return failureCount < 1;
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

function relWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d)) return formatDate(iso);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return formatDate(iso);
}

function pct(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function cashbackBrief(input: {
  credited: number;
  creditedCount: number;
  pending: number;
  pendingCount: number;
  reversed: number;
  reversedCount: number;
  thisMonth: number;
}) {
  const { credited, creditedCount, pending, pendingCount, reversed, reversedCount, thisMonth } = input;
  const volume = creditedCount + pendingCount + reversedCount;

  if (volume === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning:
        "The cashback desk is live, but no membership reward has been accrued yet. Empty is a new club ledger — not a broken page.",
      impact: "Customers will not see wallet credits until the first eligible booking completes.",
      action: "Keep membership plans honest. Cashback credits after a completed, paid booking — never from the client.",
    };
  }

  const reverseRate = pct(reversedCount, creditedCount + reversedCount);
  if (pendingCount >= 12 || reverseRate >= 20) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        reverseRate >= 20
          ? `Reversal is ${reverseRate}%. Refunds are clawing cashback faster than the club should allow.`
          : `${formatNumber(pendingCount)} credits sit pending. Wallet has not received them yet — this is the CFO cashback liability line.`,
      impact: `${inr(pending, true)} pending · ${inr(credited, true)} credited · ${inr(reversed, true)} reversed.`,
      action:
        pendingCount >= 12
          ? "Inspect the oldest pending row. Settlement should follow booking completion without a pile-up."
          : "Open Reversed and the booking file. Do not scale cashback % on a leaky refund funnel.",
    };
  }

  if (pendingCount > 0 || reversedCount > 0) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        pendingCount > 0
          ? `${formatNumber(pendingCount)} credit${pendingCount === 1 ? "" : "s"} accrued after completion, still waiting on the wallet.`
          : `${formatNumber(reversedCount)} reversal${reversedCount === 1 ? "" : "s"} were clawed back from refunded bookings.`,
      impact: `${inr(thisMonth, true)} credited this month · ${inr(pending, true)} still pending.`,
      action:
        pendingCount > 0
          ? "Open Pending and confirm the engine is settling. Pending is liability until the wallet posts."
          : "Review reversed rows against refunds before changing cashback percentages.",
    };
  }

  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Pending is clear. Credits are landing in wallets after eligible bookings complete.",
    impact: `${inr(credited, true)} credited across ${formatNumber(creditedCount)} bookings · ${inr(thisMonth, true)} this month.`,
    action: "Keep entitlements honest. No cashback-desk action required.",
  };
}

function EmptyLane({
  icon: Icon,
  tone = "success",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof Coins;
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

function PersonMini({
  name,
  meta,
  value,
  onOpen,
}: {
  name: string;
  meta?: string;
  value: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="cu-avatar cb-avatar" aria-hidden>
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">{meta || "—"}</p>
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--color-biz-accent)]">{value}</span>
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

const INSPECT_GUIDE = [
  { icon: Users, tone: "cyan" as const, title: "Member", copy: "Who earned the credit" },
  { icon: Coins, tone: "success" as const, title: "Credit", copy: "Percent, amount, booking settle" },
  { icon: Wallet, tone: "warning" as const, title: "Wallet", copy: "Pending vs posted to wallet" },
  { icon: RotateCcw, tone: "danger" as const, title: "Reversal", copy: "Clawback after a refund" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={Coins} tone="success" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Credit file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a credit — or use ↑ ↓ — to inspect member, booking, and wallet status.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Credit file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg cb-avatar cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected credit</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The ledger is empty — credits land here after eligible bookings complete"}
            </p>
          </div>
        </div>
        <dl className="cu-dock__stats">
          {[
            ["Amount", "—"],
            ["Percent", "—"],
            ["Booking", "—"],
            ["Status", "—"],
          ].map(([label, value]) => (
            <div key={label} className="cu-stat cu-stat--ghost">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
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

function statusCopy(status: string) {
  const s = status.toLowerCase();
  if (s === "pending") {
    return "Accrued after booking completion. Wallet has not been credited yet — this is the CFO cashback liability line.";
  }
  if (s === "credited") {
    return "Posted to the member wallet. From here it sits inside wallet liability until the member spends it.";
  }
  if (s === "reversed") {
    return "Clawed back after a refund. The wallet was debited so the original credit cannot be spent twice.";
  }
  if (s === "redeemed") {
    return "Marked redeemed. Spend itself lives on the wallet ledger once the member uses the balance.";
  }
  return "Server-generated membership cashback. Amounts are never trusted from the client.";
}

export default function MembershipCashbackPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"booking" | "id" | null>(null);

  const reportParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [debouncedSearch, endDate, page, startDate, statusFilter],
  );

  const dashboardQ = useQuery({
    queryKey: ["admin", "membership", "cashback"],
    queryFn: () => adminApi.subscriptions.cashbackDashboard(),
    retry: skipForbidden,
  });
  const liabilityQ = useQuery({
    queryKey: ["admin", "membership", "cashback", "liability"],
    queryFn: () => adminApi.subscriptions.cashbackLiability(),
    retry: skipForbidden,
  });
  const reportsQ = useQuery({
    queryKey: ["admin", "membership", "cashback", "reports", reportParams],
    queryFn: () => adminApi.subscriptions.cashbackReports(reportParams),
    retry: skipForbidden,
  });

  const d = dashboardQ.data;
  const liab = liabilityQ.data;
  const rows = useMemo(() => reportsQ.data?.reports ?? [], [reportsQ.data?.reports]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const totalCredited = d?.totalCredited ?? liab?.creditedTotal ?? 0;
  const creditedCount = d?.totalTransactions ?? liab?.creditedCount ?? 0;
  const pending = d?.pendingLiability ?? 0;
  const pendingCount = d?.pendingCount ?? 0;
  const thisMonth = d?.thisMonthCredited ?? 0;
  const thisMonthCount = d?.thisMonthCount ?? 0;
  const reversed = liab?.reversedTotal ?? 0;
  const reversedCount = liab?.reversedCount ?? 0;
  const netLiability = liab?.netLiability ?? totalCredited - reversed;
  const topUsers = d?.topUsers ?? [];
  const byPct = [...(liab?.byCashbackPct ?? [])].sort((a, b) => b.total - a.total);

  const filtersOn =
    Boolean(debouncedSearch) || statusFilter !== "all" || Boolean(startDate) || Boolean(endDate);

  const settleRate = pct(creditedCount, creditedCount + pendingCount);
  const reverseRate = pct(reversedCount, creditedCount + reversedCount);
  const pendingShare = pct(pending, pending + totalCredited);

  const brief = cashbackBrief({
    credited: totalCredited,
    creditedCount,
    pending,
    pendingCount,
    reversed,
    reversedCount,
    thisMonth,
  });

  const headerTone: Icon3DTone =
    brief.state === "critical"
      ? "danger"
      : brief.state === "watch"
        ? "warning"
        : brief.state === "seed"
          ? "warning"
          : "success";

  const pageAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const pendingOnPage = rows.filter((r) => r.status === "pending").length;
  const reversedOnPage = rows.filter((r) => r.status === "reversed").length;

  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId) && !reportsQ.isFetching) {
      setSelectedId(null);
    }
  }, [reportsQ.isFetching, rows, selectedId]);

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
      if (typing || rows.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(rows[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId]);

  const fetching = dashboardQ.isFetching || liabilityQ.isFetching || reportsQ.isFetching;

  const refresh = () => {
    void dashboardQ.refetch();
    void liabilityQ.refetch();
    void reportsQ.refetch();
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const openFromList = (query?: string, id?: string) => {
    if (query) setSearch(query);
    setStatusFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
    if (id) setSelectedId(id);
  };

  const copyText = async (value: string, kind: "booking" | "id") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* ignore */
    }
  };

  const setLane = (lane: StatusFilter) => {
    setStatusFilter(lane);
    setPage(1);
  };

  return (
    <div className="exec-hq cu-page mb-page cb-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="mb-hero-sheen" aria-hidden />
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Coins} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Cashback</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Club rewards
                </span>
                <span
                  className={cn(
                    "ops-alert-pill",
                    brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good",
                  )}
                >
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Server-generated membership cashback after a completed booking — pending liability, wallet credits, and refund clawbacks, one file at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="mb-chip-card">
              <span>Pending</span>
              <strong>{dashboardQ.isLoading && !pending ? "—" : inr(pending, true)}</strong>
            </div>
            <button type="button" onClick={refresh} className="biz-btn">
              <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
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
          label="Total credited"
          value={inr(totalCredited, true)}
          sub={creditedCount ? `${formatNumber(creditedCount)} wallet posts` : "lifetime posted"}
          icon={Coins}
          loading={dashboardQ.isLoading}
          tone={totalCredited > 0 ? "success" : "default"}
        />
        <StatTile
          label="Pending liability"
          value={inr(pending, true)}
          sub={pendingCount ? `${formatNumber(pendingCount)} awaiting wallet` : "CFO cashback line"}
          icon={Landmark}
          loading={dashboardQ.isLoading}
          tone={pendingCount > 0 ? "danger" : "success"}
        />
        <StatTile
          label="This month"
          value={inr(thisMonth, true)}
          sub={thisMonthCount ? `${formatNumber(thisMonthCount)} credits` : "posted this calendar month"}
          icon={Sparkles}
          loading={dashboardQ.isLoading}
          tone={thisMonth > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Reversed"
          value={inr(reversed, true)}
          sub={
            reversedCount
              ? `${formatNumber(reversedCount)} clawbacks · ${reverseRate}% rate`
              : "refund clawbacks"
          }
          icon={RotateCcw}
          loading={liabilityQ.isLoading}
          tone={reversedCount > 0 ? "danger" : "success"}
        />
      </section>

      {(pendingCount > 0 || reversedCount > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {pendingCount > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "pending" && "is-on")}
              onClick={() => setLane("pending")}
            >
              <Wallet size={14} />
              {pendingCount} pending
            </button>
          ) : null}
          {reversedCount > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-hot", statusFilter === "reversed" && "is-on")}
              onClick={() => setLane("reversed")}
            >
              <RotateCcw size={14} />
              {reversedCount} reversed
            </button>
          ) : null}
          <Link href="/finance/liabilities" className="cu-rail__chip">
            <Landmark size={14} />
            Net {inr(netLiability, true)}
            <ArrowUpRight size={11} />
          </Link>
        </section>
      )}

      <section className={cn("cu-stage", selected ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Ledger</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {reportsQ.isLoading ? "Loading…" : `${formatNumber(reportsQ.data?.total ?? 0)} matching`}
                  {pageAmount > 0 ? ` · ${inr(pageAmount, true)} on this page` : ""}
                  {pendingOnPage > 0 ? ` · ${pendingOnPage} pending here` : ""}
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
                placeholder="Member, email, booking #…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Lane">
                {STATUS_LANES.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setLane(key)}
                    className={cn("cu-chip", statusFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Created">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setPage(1);
                    setStartDate(e.target.value);
                  }}
                  className="cb-date-input"
                  aria-label="From date"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setPage(1);
                    setEndDate(e.target.value);
                  }}
                  className="cb-date-input"
                  aria-label="To date"
                />
              </FilterGroup>
            </div>
          </div>

          <div className="cu-ledger__body">
            {reportsQ.isFetching && !reportsQ.isLoading ? <div className="cu-updating">Updating…</div> : null}

            {reportsQ.isLoading ? (
              <div className="cu-list">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="biz-skeleton h-[4.75rem] rounded-2xl" />
                ))}
              </div>
            ) : reportsQ.isError ? (
              <div className="cu-empty-wrap">
                <p className="text-sm">Could not load cashback reports.</p>
                <button type="button" onClick={() => void reportsQ.refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Coins}
                  title={filtersOn ? "No match" : "Ledger is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search, lane, or dates."
                      : "Credits appear here after a member completes an eligible booking. Amounts are computed on the server."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {rows.map((r) => {
                  const on = selectedId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : r.id)}
                        className={cn(
                          "cu-row cb-row",
                          on && "is-on",
                          r.status === "pending" && "is-pending",
                          r.status === "credited" && "is-credited",
                          r.status === "reversed" && "is-reversed",
                        )}
                      >
                        <span
                          className={cn(
                            "cu-avatar cb-avatar",
                            r.status === "credited" && "is-live",
                            r.status === "pending" && "is-pending",
                          )}
                          aria-hidden
                        >
                          {initials(r.user)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 max-w-full truncate text-[0.95rem] font-semibold tracking-tight">
                              {r.user}
                            </p>
                            <StatusBadge status={r.status} />
                          </div>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span>{r.bookingNumber}</span>
                            <span>{r.cashbackPct}% of {inr(r.settledAmount, true)}</span>
                            <span>{relWhen(r.createdAt)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{inr(r.amount, true)}</p>
                          <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">{r.email}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Pagination
            page={reportsQ.data?.page ?? page}
            total={reportsQ.data?.total ?? 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            isFetching={reportsQ.isFetching}
            className="cu-pager"
          />
        </div>

        <aside className={cn("cu-dock cu-panel", selected ? "is-open" : "is-idle")}>
          {selected ? (
            <InspectFile
              row={selected}
              copied={copied}
              onCopy={copyText}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <InspectIdle matching={reportsQ.data?.total ?? rows.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor cb-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Coins}
            tone={settleRate >= 80 ? "success" : pendingCount > 0 ? "warning" : "success"}
            title="Settle pulse"
            subtitle="Posted credits versus pending wallet posts"
          />
          <div className="mb-pulse">
            <GlassRing3D
              value={settleRate}
              label="Posted"
              sub={`${formatNumber(creditedCount)} of ${formatNumber(creditedCount + pendingCount)}`}
              tone={settleRate >= 80 ? "success" : settleRate > 0 ? "warning" : "danger"}
            />
            <div className="mb-meters">
              <MeterBar
                label="Settle rate"
                value={settleRate}
                tone={settleRate >= 80 ? "success" : "accent"}
              />
              <MeterBar
                label="Pending share"
                value={pendingShare}
                tone={pendingShare > 0 ? "danger" : "success"}
              />
              <MeterBar
                label="Reversal"
                value={reverseRate}
                tone={reverseRate >= 10 ? "danger" : "success"}
              />
            </div>
          </div>
          {reversedOnPage > 0 ? (
            <p className="mt-3 text-xs text-[var(--color-biz-muted)]">
              {reversedOnPage} reversal{reversedOnPage === 1 ? "" : "s"} on this page — clawbacks follow refunds, not manual edits.
            </p>
          ) : null}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Sparkles} tone="warning" title="Rate mix" subtitle="Credited rupees by cashback %" />
          {byPct.length > 0 ? (
            <IsoBarChart
              data={byPct.map((b) => ({
                label: `${b.cashbackPct}%`,
                value: b.total,
              }))}
              format={(v) => inr(v, true)}
              accent="amber"
              layout="bar"
              height={220}
              isLoading={liabilityQ.isLoading}
            />
          ) : liabilityQ.isError ? (
            <EmptyLane
              icon={Sparkles}
              tone="warning"
              title="Mix not in this role"
              reason="Percent buckets need membership liability access. The ledger above still runs."
            />
          ) : (
            <EmptyLane
              icon={Sparkles}
              title="No mix yet"
              reason="Rate share appears once the first cashback is credited to a wallet."
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Users}
            tone="success"
            title="Top earners"
            subtitle="Members with the most credited cashback"
            action={
              <Link href="/customers" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Customers
              </Link>
            }
          />
          {dashboardQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : dashboardQ.isError ? (
            <EmptyLane
              icon={Users}
              tone="warning"
              title="Earners not in this role"
              reason="Top members need membership cashback access."
            />
          ) : topUsers.length > 0 ? (
            <div className="space-y-2">
              {topUsers.slice(0, 6).map((u) => (
                <PersonMini
                  key={u.userId}
                  name={u.name}
                  meta="Lifetime credited"
                  value={inr(u.totalCashback, true)}
                  onOpen={() => openFromList(u.name)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={Users}
              tone="success"
              title="No earners yet"
              reason="Names rank here after the first credit posts to a wallet."
              href="/membership"
              cta="Membership"
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Crown} tone="warning" title="Club ops" subtitle="Plans, coupons, wallet liability, bookings" />
          <div className="mb-ops">
            <Link href="/membership" className="mb-ops__row">
              <Icon3D icon={Crown} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Membership</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">Plans set the cashback percent on each booking</p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/finance/liabilities" className="mb-ops__row">
              <Icon3D icon={Landmark} tone="danger" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">CFO liabilities</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  Pending cashback is the cashback line. Credited sits in wallet liability.
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/membership/coupons" className="mb-ops__row">
              <Icon3D icon={Gift} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Coupons</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">Plan-restricted discounts beside cashback</p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/bookings" className="mb-ops__row">
              <Icon3D icon={Wallet} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Bookings</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  Credit fires when a job completes. Refunds reverse it.
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function InspectFile({
  row,
  copied,
  onCopy,
  onClose,
}: {
  row: AdminCashbackReportRow;
  copied: "booking" | "id" | null;
  onCopy: (value: string, kind: "booking" | "id") => void;
  onClose: () => void;
}) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className={cn(
              "cu-avatar cu-avatar--lg cb-avatar",
              row.status === "credited" && "is-live",
              row.status === "pending" && "is-pending",
            )}
          >
            {initials(row.user)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold tracking-tight">{row.user}</h2>
              <StatusBadge status={row.status} />
            </div>
            <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">{row.email}</p>
            <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{row.bookingNumber}</p>
          </div>
        </div>
        <button type="button" className="biz-btn !px-2.5" onClick={onClose} aria-label="Close file">
          <X size={14} />
        </button>
      </div>

      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Cashback credit details">
        <dl className="cu-dock__stats">
          <div className="cu-stat">
            <dt>Amount</dt>
            <dd>{inr(row.amount)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Percent</dt>
            <dd>{row.cashbackPct}%</dd>
          </div>
          <div className="cu-stat">
            <dt>Settled on</dt>
            <dd>{inr(row.settledAmount)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Created</dt>
            <dd>{formatDate(row.createdAt)}</dd>
          </div>
        </dl>

        <div className="cb-note">
          <p className="cu-intel__label">What this row is</p>
          <p>{statusCopy(row.status)}</p>
        </div>
      </div>

      <div className="cu-dock__actions">
        <div className="flex flex-wrap gap-2">
          <Link href={`/customers?q=${encodeURIComponent(row.email)}`} className="biz-btn text-xs">
            Member
          </Link>
          <Link href={`/bookings?q=${encodeURIComponent(row.bookingNumber)}`} className="biz-btn text-xs">
            Booking
          </Link>
          <button type="button" className="biz-btn text-xs" onClick={() => onCopy(row.bookingNumber, "booking")}>
            <Copy size={13} />
            {copied === "booking" ? "Copied" : "Number"}
          </button>
          <button type="button" className="biz-btn text-xs" onClick={() => onCopy(row.id, "id")}>
            <Copy size={13} />
            {copied === "id" ? "Copied" : "ID"}
          </button>
        </div>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}
