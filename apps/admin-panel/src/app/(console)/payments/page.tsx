"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Banknote,
  CreditCard,
  FilterX,
  Landmark,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAdminAnalyticsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { adminApi } from "@/services/admin-api";
import { daysAgoIso, formatNumber, inr, todayIso } from "@/lib/format";
import { AdminApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import type { AnalyticsData } from "@/types/admin";

const PRESETS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];
type ServiceRow = AnalyticsData["topServices"][number];

const JUMPS = [
  { href: "/hq/finance", label: "Finance HQ" },
  { href: "/finance/payouts", label: "Payouts" },
  { href: "/finance/refunds", label: "Refunds" },
  { href: "/finance/reconciliation", label: "Reconciliation" },
  { href: "/finance/liabilities", label: "Liabilities" },
  { href: "/bookings", label: "Bookings" },
] as const;

function skipForbidden(failureCount: number, error: unknown) {
  if (error instanceof AdminApiError && (error.status === 403 || error.status === 401)) return false;
  return failureCount < 1;
}

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function moneyBag(v: unknown): { count: number; amount: number } {
  const o = rec(v);
  return { count: num(o.count), amount: num(o.amount) };
}

function pct(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
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

function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function paymentsBrief(input: {
  revenue: number;
  commission: number;
  payouts: number;
  takePct: number;
  completed: number;
  settlement: number;
  chargebacks: number;
  refunds: number;
}) {
  const { revenue, commission, payouts, takePct, completed, settlement, chargebacks, refunds } = input;

  if (revenue <= 0 && completed === 0) {
    return {
      state: "seed" as const,
      label: "Quiet",
      meaning: "No successful payment landed in this window. Empty is a quiet till — not a broken page.",
      impact: "Commission and partner payouts stay at zero until the next completed, paid booking.",
      action: "Widen the window, or open Bookings to see work still in flight.",
    };
  }

  if (takePct >= 35 || chargebacks > 0 || settlement >= revenue * 0.6 && settlement > 0) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        takePct >= 35
          ? `Take rate is ${takePct}%. Partners are keeping too little of the job — this will show up as payout friction.`
          : chargebacks > 0
            ? `${inr(chargebacks, true)} sits in open chargebacks. That is cash at risk, not a closed booking.`
            : `${inr(settlement, true)} of successful payments is still unsettled with the gateway.`,
      impact: `${inr(revenue, true)} GMV · ${inr(commission, true)} take · ${inr(payouts, true)} to partners.`,
      action:
        chargebacks > 0
          ? "Open Chargebacks and evidence the open cases before they age."
          : takePct >= 35
            ? "Check tier commission on the hottest service. Do not raise take on a thin partner ledger."
            : "Open Settlement Sync. Unsettled SUCCESS payments should not pile up.",
    };
  }

  if (refunds > 0 || settlement > 0 || takePct > 0 && takePct < 10) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        refunds > 0
          ? `${inr(refunds, true)} has been refunded. That money left the till after a SUCCESS payment.`
          : settlement > 0
            ? `${inr(settlement, true)} is still waiting on gateway settlement.`
            : `Take rate is ${takePct}%. The cut is thin against the commissionable gross.`,
      impact: `${formatNumber(completed)} completed · ${inr(payouts, true)} partner net.`,
      action: refunds > 0 ? "Open Refunds and match them to the booking file." : "Watch the next settlement run. HIGH-volume days should clear.",
    };
  }

  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Paid bookings are splitting into platform take and partner net at a normal rate.",
    impact: `${inr(revenue, true)} GMV · ${takePct}% take · ${inr(payouts, true)} to partners.`,
    action: "No payments-desk action required. Keep reconciliation on the usual cadence.",
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
  icon: typeof CreditCard;
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
  { icon: CreditCard, tone: "success" as const, title: "GMV", copy: "Paid bookings in this window" },
  { icon: Landmark, tone: "cyan" as const, title: "Take", copy: "Recorded platform commission" },
  { icon: Banknote, tone: "warning" as const, title: "Partner net", copy: "What the vendor actually earned" },
  { icon: Scale, tone: "danger" as const, title: "Split", copy: "Never estimated — from Earning rows" },
];

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cu-filter">
      <span className="cu-filter__label">{label}</span>
      <div className="cu-filter__row">{children}</div>
    </div>
  );
}

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={CreditCard} tone="success" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Service file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a service — or use ↑ ↓ — to inspect GMV, take, and partner net.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Service file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg pay-avatar cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected service</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} in this window · pick any row on the left`
                : "Paid jobs land here after a booking completes"}
            </p>
          </div>
        </div>
        <dl className="cu-dock__stats">
          {[
            ["Revenue", "—"],
            ["Take", "—"],
            ["Partner net", "—"],
            ["Jobs", "—"],
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

export default function PaymentsPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<PresetId>("30d");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 220);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
  const range = useMemo(
    () => ({ startDate: daysAgoIso(days - 1), endDate: todayIso() }),
    [days],
  );

  const dashboard = useAdminDashboardQuery();
  const analytics = useAdminAnalyticsQuery(range);
  const financeQ = useQuery({
    queryKey: ["admin", "finance", "dashboard", days],
    queryFn: () => adminApi.financeDashboard(days),
    retry: skipForbidden,
    staleTime: 60_000,
  });

  const overview = analytics.data?.overview;
  const revenue = num(overview?.totalRevenue);
  const commission = num(overview?.platformCommission);
  const payouts = num(overview?.providerPayouts);
  const takePct = num(overview?.commissionPercentage);
  const completed = num(overview?.completedBookings);
  const cancelled = num(overview?.cancelledBookings);
  const bookings = num(overview?.totalBookings);
  const monthRev = num(dashboard.data?.stats.thisMonthRevenue);

  const fin = rec(financeQ.data?.overview);
  const settlement = moneyBag(fin.settlementPending);
  const chargeback = moneyBag(fin.chargebackExposure);
  const refunds = num(fin.refundLiability);
  const gmv = num(fin.gmv) || revenue;
  const netRevenue = num(fin.netRevenue);

  const services = useMemo(() => analytics.data?.topServices ?? [], [analytics.data?.topServices]);
  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;
    return [...list].sort((a, b) => b.revenue - a.revenue);
  }, [debouncedSearch, services]);

  const selected = rows.find((s) => s.name === selectedName) ?? null;
  const filtersOn = Boolean(debouncedSearch);

  const brief = paymentsBrief({
    revenue,
    commission,
    payouts,
    takePct,
    completed,
    settlement: settlement.amount,
    chargebacks: chargeback.amount,
    refunds,
  });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "default" : "success";

  const trend = useMemo(() => {
    const src = financeQ.data?.trend ?? [];
    const slice = src.length > 21 ? src.slice(-21) : src;
    return slice.map((d) => ({ label: dayLabel(d.date), value: d.amount }));
  }, [financeQ.data?.trend]);

  useEffect(() => {
    if (selectedName && !rows.some((s) => s.name === selectedName) && !analytics.isFetching) {
      setSelectedName(null);
    }
  }, [analytics.isFetching, rows, selectedName]);

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
        setSelectedName(null);
        return;
      }
      if (typing || rows.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedName ? rows.findIndex((s) => s.name === selectedName) : -1;
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedName(rows[next]!.name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedName]);

  const fetching = analytics.isFetching || financeQ.isFetching || dashboard.isFetching;
  const refresh = () => {
    void analytics.refetch();
    void financeQ.refetch();
    void dashboard.refetch();
  };
  const payoutShare = pct(payouts, Math.max(payouts + commission, 1));
  const completeRate = pct(completed, bookings);

  return (
    <div className="exec-hq cu-page pay-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="pay-hero-sheen" aria-hidden />
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={CreditCard} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Payments</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Till desk
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
                Razorpay GMV, recorded platform take, and partner net — one service file at a time. Commission is never estimated.
              </p>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <div className="mb-chip-card pay-chip-card">
              <span>GMV</span>
              <strong>{analytics.isLoading && !revenue ? "—" : inr(revenue, true)}</strong>
            </div>
            <div className="cu-filter__row">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={cn("cu-chip", preset === p.id && "is-on")}
                >
                  {p.label}
                </button>
              ))}
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
          label={`Revenue · ${days}d`}
          value={inr(revenue, true)}
          sub={monthRev ? `${inr(monthRev, true)} this calendar month` : "paid booking GMV"}
          icon={CreditCard}
          loading={analytics.isLoading}
          tone={revenue > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Platform take"
          value={inr(commission, true)}
          sub={takePct ? `${takePct}% of commissionable gross` : "from Earning rows"}
          icon={Landmark}
          loading={analytics.isLoading}
          tone={takePct >= 35 ? "danger" : "success"}
        />
        <StatTile
          label="Partner net"
          value={inr(payouts, true)}
          sub={payoutShare ? `${payoutShare}% of the split` : "vendor earnings"}
          icon={Banknote}
          loading={analytics.isLoading}
          tone="default"
        />
        <StatTile
          label="Take rate"
          value={`${takePct.toFixed(1)}%`}
          sub={completed ? `${formatNumber(completed)} completed jobs` : "server-computed"}
          icon={Scale}
          loading={analytics.isLoading}
          tone={takePct >= 35 ? "danger" : takePct > 0 ? "success" : "default"}
        />
      </section>

      {(settlement.amount > 0 || chargeback.amount > 0 || refunds > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {settlement.amount > 0 ? (
            <Link href="/finance/settlement-sync" className="cu-rail__chip is-warm">
              <Scale size={14} />
              {inr(settlement.amount, true)} unsettled
              {settlement.count ? ` · ${formatNumber(settlement.count)}` : ""}
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {refunds > 0 ? (
            <Link href="/finance/refunds" className="cu-rail__chip">
              <RotateCcw size={14} />
              {inr(refunds, true)} refunded
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {chargeback.amount > 0 ? (
            <Link href="/finance/chargebacks" className="cu-rail__chip is-hot">
              <Landmark size={14} />
              {inr(chargeback.amount, true)} chargebacks
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Top services</h2>
                <p className="mt-1 min-w-0 truncate text-xs text-[var(--color-biz-muted)]">
                  {analytics.isLoading
                    ? "Loading…"
                    : `${formatNumber(rows.length)} in ${range.startDate} → ${range.endDate}`}
                  {cancelled ? ` · ${formatNumber(cancelled)} cancelled in window` : ""}
                </p>
              </div>
              {filtersOn ? (
                <button type="button" className="biz-btn !px-2.5 text-xs" onClick={() => setSearch("")}>
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Service name…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Window">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className={cn("cu-chip", preset === p.id && "is-on")}
                  >
                    {p.label}
                  </button>
                ))}
              </FilterGroup>
            </div>
          </div>

          <div className="cu-ledger__body">
            {analytics.isLoading ? (
              <div className="biz-skeleton m-4 h-48 rounded-2xl" />
            ) : analytics.isError ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={CreditCard}
                  tone="warning"
                  title="Payments not in this role"
                  reason="This desk needs analytics access. Finance HQ still runs for CFO roles."
                  href="/hq/finance"
                  cta="Finance HQ"
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={CreditCard}
                  title={filtersOn ? "No match" : "No paid jobs in this window"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search."
                      : "Completed, paid bookings appear here. Commission is read from Earning rows — never guessed."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {rows.map((s) => {
                  const on = selectedName === s.name;
                  const share = pct(s.revenue, revenue);
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        onClick={() => setSelectedName(on ? null : s.name)}
                        className={cn("cu-row pay-row", on && "is-on")}
                      >
                        <span className="cu-avatar pay-avatar" aria-hidden>
                          {initials(s.name)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="min-w-0 max-w-full truncate text-[0.95rem] font-semibold tracking-tight">
                            {s.name}
                          </p>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span>{formatNumber(s.bookings)} jobs</span>
                            <span>Take {inr(s.commission, true)}</span>
                            {share ? <span>{share}% of GMV</span> : null}
                          </p>
                        </div>
                        <div className="hidden min-w-0 shrink-0 text-right sm:block">
                          <p className="truncate text-[0.95rem] font-bold tabular-nums tracking-tight">
                            {inr(s.revenue, true)}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">
                            Net {inr(s.netEarning, true)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="cu-pager min-w-0 truncate text-[11px] text-[var(--color-biz-muted)]">
            Take is the actual platform commission recorded on completed bookings — not a frontend estimate.
          </p>
        </div>

        <aside className={cn("cu-dock cu-panel", selected ? "is-open" : "is-idle")}>
          {selected ? (
            <InspectFile row={selected} windowGmv={revenue} onClose={() => setSelectedName(null)} />
          ) : (
            <InspectIdle matching={rows.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor pay-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Scale}
            tone={takePct >= 35 ? "danger" : takePct > 0 ? "success" : "cyan"}
            title="Split pulse"
            subtitle="Platform take versus partner net in this window"
          />
          <div className="mb-pulse">
            <GlassRing3D
              value={takePct}
              label="Take"
              sub={`${inr(commission, true)} of ${inr(Math.max(commission + payouts, revenue), true)}`}
              tone={takePct >= 35 ? "danger" : takePct > 0 ? "success" : "warning"}
            />
            <div className="mb-meters">
              <MeterBar label="Take rate" value={takePct} tone={takePct >= 35 ? "danger" : "success"} />
              <MeterBar label="Partner share" value={payoutShare} tone="accent" />
              <MeterBar label="Completed" value={completeRate} tone={completeRate >= 70 ? "success" : "accent"} />
            </div>
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={TrendingUp}
            tone="success"
            title="Daily GMV"
            subtitle={trend.length ? `Latest ${trend.length} days in this window` : "Paid amount by day"}
          />
          {trend.length > 0 ? (
            <IsoBarChart
              data={trend}
              format={(v) => inr(v, true)}
              accent="emerald"
              layout="bar"
              height={220}
              isLoading={financeQ.isLoading}
            />
          ) : financeQ.isError ? (
            <EmptyLane
              icon={TrendingUp}
              tone="warning"
              title="Trend not in this role"
              reason="Daily GMV needs finance dashboard access. The service ledger above still runs."
            />
          ) : (
            <EmptyLane
              icon={TrendingUp}
              title="No daily movement"
              reason="Bars appear after the first SUCCESS payment in this window."
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Wallet} tone="cyan" title="Finance ops" subtitle="Payouts, refunds, settlement, liabilities" />
          <div className="mb-ops">
            <Link href="/finance/payouts" className="mb-ops__row">
              <Icon3D icon={Banknote} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Payouts</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Partner withdrawals against the net in this till
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/finance/refunds" className="mb-ops__row">
              <Icon3D icon={RotateCcw} tone="danger" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Refunds</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  {refunds > 0 ? `${inr(refunds, true)} refunded in the ledger` : "Clawbacks after a SUCCESS payment"}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/finance/settlement-sync" className="mb-ops__row">
              <Icon3D icon={Scale} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Settlement</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  {settlement.amount > 0
                    ? `${inr(settlement.amount, true)} still unsettled`
                    : "Gateway settlement against SUCCESS payments"}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/finance/liabilities" className="mb-ops__row">
              <Icon3D icon={Wallet} tone="success" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Liabilities</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  {financeQ.isError
                    ? "Not in this role"
                    : netRevenue
                      ? `Net ${inr(netRevenue, true)} after refunds · GMV ${inr(gmv, true)}`
                      : "Wallet, cashback, and provider payable"}
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
  windowGmv,
  onClose,
}: {
  row: ServiceRow;
  windowGmv: number;
  onClose: () => void;
}) {
  const share = pct(row.revenue, windowGmv);
  const localTake = pct(row.commission, row.revenue);

  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-start gap-4">
          <span className="cu-avatar cu-avatar--lg pay-avatar">{initials(row.name)}</span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight">{row.name}</h2>
            <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">
              {formatNumber(row.bookings)} completed in this window
            </p>
            <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">
              {share ? `${share}% of window GMV` : "Share appears once GMV is live"}
            </p>
          </div>
        </div>
        <button type="button" className="biz-btn !px-2.5" onClick={onClose} aria-label="Close file">
          <X size={14} />
        </button>
      </div>

      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Service payment details">
        <dl className="cu-dock__stats">
          <div className="cu-stat">
            <dt>Revenue</dt>
            <dd>{inr(row.revenue, true)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Take</dt>
            <dd>{inr(row.commission, true)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Partner net</dt>
            <dd>{inr(row.netEarning, true)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Jobs</dt>
            <dd>{formatNumber(row.bookings)}</dd>
          </div>
        </dl>

        <MeterBar label="Service take" value={localTake} tone={localTake >= 35 ? "danger" : "success"} />
        <MeterBar label="Share of window" value={share} tone="accent" />

        <div className="cb-note pay-note">
          <p className="cu-intel__label">What this row is</p>
          <p>
            Commission and net come from Earning rows on completed bookings — not a percentage typed in the browser.
            Open Bookings to see the jobs behind this service.
          </p>
        </div>
      </div>

      <div className="cu-dock__actions">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Link href={`/bookings?q=${encodeURIComponent(row.name)}`} className="biz-btn text-xs">
            Bookings
          </Link>
          <Link href="/services" className="biz-btn text-xs">
            Catalog
          </Link>
          <Link href="/finance/payouts" className="biz-btn text-xs">
            Payouts
          </Link>
        </div>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}
