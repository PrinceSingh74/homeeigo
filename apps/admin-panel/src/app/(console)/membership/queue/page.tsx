"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarCheck,
  Clock,
  Copy,
  Crown,
  FilterX,
  Gauge,
  Gift,
  Radio,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  Timer,
  Users,
  X,
  Zap,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  adminApi,
  type AdminQueueBooking,
} from "@/services/admin-api";
import { formatDate, formatNumber, formatWait } from "@/lib/format";
import { AdminApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type LaneFilter = "all" | "high" | "normal" | "stale";

const HIGH_SLA_MS = 30 * 60_000;
const NORMAL_SLA_MS = 3 * 60 * 60_000;
const STALE_MS = 60 * 60_000;

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/membership", label: "Membership" },
  { href: "/bookings", label: "Bookings" },
  { href: "/operations", label: "Live Ops" },
  { href: "/membership/cashback", label: "Cashback" },
  { href: "/membership/coupons", label: "Coupons" },
] as const;

const LANES: Array<[LaneFilter, string]> = [
  ["all", "All"],
  ["high", "HIGH"],
  ["normal", "Normal"],
  ["stale", "Stale"],
];

const TIER_ORDER = ["platinum", "gold", "silver", "free"] as const;

function skipForbidden(failureCount: number, error: unknown) {
  if (error instanceof AdminApiError && (error.status === 403 || error.status === 401)) return false;
  return failureCount < 1;
}

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
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

function isHigh(row: Pick<AdminQueueBooking, "queuePriority">) {
  return String(row.queuePriority ?? "").toLowerCase() === "high";
}

function waitMs(row: AdminQueueBooking) {
  return num(row.waitTimeMs);
}

function isStale(row: AdminQueueBooking) {
  const wait = waitMs(row);
  if (wait <= 0) return false;
  return isHigh(row) ? wait >= HIGH_SLA_MS : wait >= NORMAL_SLA_MS;
}

function laneOf(row: AdminQueueBooking): "high" | "normal" {
  return isHigh(row) ? "high" : "normal";
}

function slotLabel(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function queuedLabel(iso?: string | null) {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d)) return formatDate(iso);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return formatDate(iso);
}

function etaLabel(row: AdminQueueBooking) {
  const estimated = num(row.estimatedWaitTimeMs);
  if (estimated <= 0) return "—";
  const remaining = Math.max(0, estimated - waitMs(row));
  return remaining > 0 ? formatWait(remaining, true) : "due";
}

function queueBrief(input: {
  waiting: number;
  high: number;
  avgWaitMs: number;
  /** null = UNMEASURED. No terminal dispatch outcome exists yet, which is not 0%. */
  acceptance: number | null;
  exhausted: number;
  stale: number;
}) {
  const { waiting, high, avgWaitMs, acceptance, exhausted, stale } = input;

  if (waiting === 0) {
    return {
      state: "seed" as const,
      label: "Clear",
      meaning: "No unassigned booking is sitting in the membership queue. Empty is a quiet dispatch desk — not a broken page.",
      impact: "HIGH members will skip the line the moment the next job lands.",
      action: "Keep membership plans honest. Priority only fires for live club entitlements.",
    };
  }

  /**
   * An unmeasured acceptance rate is not a bad one.
   *
   * The backend used to resolve an empty sample to 0 and `num()` turned a null into 0 as well, so a
   * platform that had simply not dispatched anything yet was told "partners are slow to take jobs".
   * The rate now arrives as null when nothing terminal has happened, and every threshold below
   * ignores it rather than reading absence as failure.
   */
  const acceptanceMeasured = acceptance != null;

  if (avgWaitMs >= 24 * 60 * 60_000 || (acceptanceMeasured && acceptance < 12) || exhausted >= 8 || stale >= 12) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        avgWaitMs >= 24 * 60 * 60_000
          ? `Average wait is ${formatWait(avgWaitMs, false)}. Jobs are ageing in the queue instead of reaching a provider.`
          : exhausted >= 8
            ? `${formatNumber(exhausted)} assignment jobs exhausted the provider list. The engine has nobody left to try.`
            : `Acceptance is ${acceptance}%. Dispatch is firing, but partners are not taking the work.`,
      impact: `${formatNumber(waiting)} waiting · ${formatNumber(high)} HIGH · ${formatNumber(stale)} past SLA.`,
      action: "Open Stale and Live Ops. Do not scale HIGH volume on a queue that nobody is accepting.",
    };
  }

  if (high > 0 || stale > 0 || (acceptanceMeasured && acceptance < 30)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        stale > 0
          ? `${formatNumber(stale)} booking${stale === 1 ? "" : "s"} are past the membership wait SLA. HIGH should move in minutes, not hours.`
          : high > 0
            ? `${formatNumber(high)} HIGH member${high === 1 ? "" : "s"} are waiting for the next free partner.`
            : `Acceptance is ${acceptance}%. The funnel is live, but partners are slow to take jobs.`,
      impact: `Avg wait ${formatWait(avgWaitMs, false)} · ${formatNumber(waiting)} in lane.`,
      action: stale > 0 ? "Filter Stale and inspect the oldest HIGH file." : "Watch the next few dispatches. HIGH must stay ahead of NORMAL.",
    };
  }

  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "HIGH members are at the front. Wait is inside SLA and partners are accepting.",
    impact: `${formatNumber(waiting)} waiting · avg ${formatWait(avgWaitMs, false)} · ${acceptance == null ? "unmeasured" : `${acceptance}%`} accept.`,
    action: "No queue-desk action required. Keep entitlements honest.",
  };
}

function EmptyLane({
  icon: Icon,
  tone = "cyan",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof Clock;
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
  { icon: Crown, tone: "warning" as const, title: "Lane", copy: "HIGH members skip NORMAL" },
  { icon: Timer, tone: "cyan" as const, title: "Wait", copy: "Time sitting without a partner" },
  { icon: Zap, tone: "success" as const, title: "Dispatch", copy: "Assignment engine attempts" },
  { icon: Radio, tone: "danger" as const, title: "Stale", copy: "Past the membership wait SLA" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={Clock} tone="cyan" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Queue file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a booking — or use ↑ ↓ — to inspect lane, wait, and dispatch.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Queue file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg pq-avatar cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected booking</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} in lane · pick any row on the left`
                : "The queue is empty — HIGH members land here the moment they book"}
            </p>
          </div>
        </div>
        <dl className="cu-dock__stats">
          {[
            ["Lane", "—"],
            ["Wait", "—"],
            ["Position", "—"],
            ["ETA", "—"],
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

function laneCopy(row: AdminQueueBooking) {
  if (isStale(row)) {
    return isHigh(row)
      ? "HIGH SLA is 30 minutes. This member paid for the front of the line and is still waiting."
      : "NORMAL SLA is 3 hours. The assignment engine should have found a partner by now.";
  }
  if (isHigh(row)) {
    return "Club entitlement put this booking ahead of NORMAL. The next free partner should see it first.";
  }
  return "Standard lane. HIGH members skip this row until the premium line is clear.";
}

export default function MembershipQueuePage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 220);
  const [lane, setLane] = useState<LaneFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"booking" | "id" | null>(null);

  const queueQ = useQuery({
    queryKey: ["admin", "membership", "queue"],
    queryFn: () => adminApi.subscriptions.queueAnalytics(),
    retry: skipForbidden,
    refetchInterval: 15_000,
  });
  const matchingQ = useQuery({
    queryKey: ["admin", "membership", "matching"],
    queryFn: () => adminApi.subscriptions.matchingAnalytics(),
    retry: skipForbidden,
  });

  const payload = queueQ.data;
  const q = payload?.queue;
  const priority = payload?.priority;
  const dispatch = payload?.dispatch;
  const health = dispatch?.queueHealth;
  const metrics = dispatch?.dispatchMetrics;
  const funnel = dispatch?.assignmentFunnel;
  const allRows = useMemo(() => payload?.assignmentQueue ?? [], [payload?.assignmentQueue]);

  const pendingHigh = num(q?.pendingHigh);
  const pendingNormal = num(q?.pendingNormal);
  const waiting = pendingHigh + pendingNormal;
  const avgWaitMs = num(q?.averageWaitTimeMs);
  // Deliberately not coerced through num(): null means UNMEASURED and must survive as null.
  const acceptance = typeof metrics?.acceptanceRatePct === "number" ? metrics.acceptanceRatePct : null;
  const exhausted = num(health?.exhaustedJobs);
  const autoReassigns = num(metrics?.autoReassignCount);
  const attempts = num(metrics?.dispatchAttempts);
  // null = UNMEASURED (nothing dispatched yet), which is not 0% conversion.
  const conversion = typeof funnel?.conversionPct === "number" ? funnel.conversionPct : null;
  const premiumShare = num(priority?.premiumSharePct);
  const matchRate = num(matchingQ.data?.premiumMatchRatePct);

  const staleCount = useMemo(() => allRows.filter(isStale).length, [allRows]);

  const rows = useMemo(() => {
    const qText = debouncedSearch.trim().toLowerCase();
    return allRows.filter((row) => {
      if (lane === "high" && !isHigh(row)) return false;
      if (lane === "normal" && isHigh(row)) return false;
      if (lane === "stale" && !isStale(row)) return false;
      if (!qText) return true;
      return [row.bookingNumber, row.user, row.service]
        .join(" ")
        .toLowerCase()
        .includes(qText);
    });
  }, [allRows, debouncedSearch, lane]);

  const selected = rows.find((r) => r.bookingId === selectedId) ?? null;
  const filtersOn = Boolean(debouncedSearch) || lane !== "all";

  const brief = queueBrief({
    waiting,
    high: pendingHigh,
    avgWaitMs,
    acceptance,
    exhausted,
    stale: staleCount,
  });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "default" : "cyan";

  const mix = useMemo(() => {
    const src = q?.queueByMembership ?? {};
    return TIER_ORDER.map((tier) => ({
      label: tier[0]!.toUpperCase() + tier.slice(1),
      value: num(src[tier]),
    })).filter((b) => b.value > 0);
  }, [q?.queueByMembership]);

  useEffect(() => {
    if (selectedId && !rows.some((r) => r.bookingId === selectedId) && !queueQ.isFetching) {
      setSelectedId(null);
    }
  }, [queueQ.isFetching, rows, selectedId]);

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
      const idx = selectedId ? rows.findIndex((r) => r.bookingId === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(rows[next]!.bookingId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId]);

  const fetching = queueQ.isFetching || matchingQ.isFetching;
  const refresh = () => {
    void queueQ.refetch();
    void matchingQ.refetch();
  };
  const clearFilters = () => {
    setSearch("");
    setLane("all");
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

  const waitTone = avgWaitMs >= STALE_MS ? "danger" : avgWaitMs > HIGH_SLA_MS ? "accent" : "success";
  /**
   * UNMEASURED renders as an em dash on a neutral tone, never as 0% in red.
   * A dispatch desk that has not yet produced a terminal outcome has not failed at anything.
   */
  const acceptanceKnown = acceptance != null;
  const acceptanceDisplay = acceptanceKnown ? `${acceptance}%` : "—";
  const acceptanceDial = acceptance ?? 0;
  const acceptTone = !acceptanceKnown
    ? "accent"
    : acceptance >= 40
      ? "success"
      : acceptance >= 15
        ? "accent"
        : "danger";
  const exhaustedShare = pct(exhausted, num(health?.totalJobs));

  return (
    <div className="exec-hq cu-page mb-page pq-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="mb-hero-sheen pq-hero-sheen" aria-hidden />
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Clock} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Priority Queue</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Dispatch desk
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
                HIGH members skip the line. This desk is the live assignment queue — wait, dispatch, and stale jobs, one file at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="mb-chip-card pq-chip-card">
              <span>Waiting</span>
              <strong>{queueQ.isLoading && !waiting ? "—" : formatNumber(waiting)}</strong>
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
          label="HIGH waiting"
          value={formatNumber(pendingHigh)}
          sub={pendingHigh ? `${formatWait(q?.avgWaitHighMs, true)} avg in HIGH` : "club skip-the-line"}
          icon={Crown}
          loading={queueQ.isLoading}
          tone={pendingHigh > 0 ? "accent" : "success"}
        />
        <StatTile
          label="NORMAL waiting"
          value={formatNumber(pendingNormal)}
          sub={pendingNormal ? `${formatWait(q?.avgWaitNormalMs, true)} avg in NORMAL` : "standard lane"}
          icon={Users}
          loading={queueQ.isLoading}
          tone={pendingNormal > 8 ? "danger" : "default"}
        />
        <StatTile
          label="Avg wait"
          value={formatWait(avgWaitMs, true)}
          sub={avgWaitMs ? `${formatWait(avgWaitMs, false)} across the live lane` : "time without a partner"}
          icon={Timer}
          loading={queueQ.isLoading}
          tone={waitTone}
        />
        <StatTile
          label="Acceptance"
          value={acceptanceDisplay}
          sub={
            acceptanceKnown
              ? attempts
                ? `${formatNumber(attempts)} dispatch attempts`
                : "partner take rate"
              : "no terminal outcome yet"
          }
          icon={Gauge}
          loading={queueQ.isLoading}
          tone={acceptTone}
        />
      </section>

      {(pendingHigh > 0 || staleCount > 0 || exhausted > 0 || autoReassigns > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {pendingHigh > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", lane === "high" && "is-on")}
              onClick={() => setLane("high")}
            >
              <Crown size={14} />
              {pendingHigh} HIGH
            </button>
          ) : null}
          {staleCount > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-hot", lane === "stale" && "is-on")}
              onClick={() => setLane("stale")}
            >
              <Timer size={14} />
              {staleCount} stale
            </button>
          ) : null}
          {exhausted > 0 ? (
            <Link href="/operations" className="cu-rail__chip is-hot">
              <Radio size={14} />
              {exhausted} exhausted
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {autoReassigns > 0 ? (
            <span className="cu-rail__chip">
              <Repeat size={14} />
              {formatNumber(autoReassigns)} reassigns
            </span>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Live lane</h2>
                <p className="mt-1 min-w-0 truncate text-xs text-[var(--color-biz-muted)]">
                  {queueQ.isLoading
                    ? "Loading…"
                    : `${formatNumber(rows.length)} showing · ${formatNumber(allRows.length)} unassigned`}
                  {staleCount > 0 ? ` · ${staleCount} past SLA` : ""}
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Booking #, member, service…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Lane">
                {LANES.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setLane(key)}
                    className={cn("cu-chip", lane === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
            </div>
          </div>

          <div className="cu-ledger__body">
            {queueQ.isLoading ? (
              <div className="biz-skeleton m-4 h-48 rounded-2xl" />
            ) : queueQ.isError ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Clock}
                  tone="warning"
                  title="Queue not in this role"
                  reason="Priority queue needs membership access. Bookings and Live Ops still run."
                  href="/bookings"
                  cta="Bookings"
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Clock}
                  title={filtersOn ? "No match" : "Lane is clear"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search or lane."
                      : "Unassigned bookings appear here. HIGH members skip NORMAL when the next partner is free."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {rows.map((r) => {
                  const on = selectedId === r.bookingId;
                  const stale = isStale(r);
                  const high = isHigh(r);
                  return (
                    <li key={r.bookingId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : r.bookingId)}
                        className={cn(
                          "cu-row pq-row",
                          on && "is-on",
                          stale && "is-stale",
                          high && !stale && "is-high",
                        )}
                      >
                        <span
                          className={cn(
                            "cu-avatar pq-avatar",
                            high && "is-high",
                            stale && "is-stale",
                          )}
                          aria-hidden
                        >
                          {initials(r.user || r.service)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 max-w-full truncate text-[0.95rem] font-semibold tracking-tight">
                              {r.bookingNumber}
                            </p>
                            <StatusBadge status={laneOf(r)} />
                            {stale ? <StatusBadge status="stale" /> : null}
                          </div>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{r.user || "Member"}</span>
                            <span className="truncate">{r.service || "Service"}</span>
                            <span className="shrink-0">#{r.queuePosition ?? r.position}</span>
                          </p>
                        </div>
                        <div className="hidden min-w-0 shrink-0 text-right sm:block">
                          <p className="truncate text-[0.95rem] font-bold tabular-nums tracking-tight">
                            {formatWait(waitMs(r), true)}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">
                            ETA {etaLabel(r)} · {r.priorityScore ?? "—"}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
            <InspectIdle matching={rows.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor pq-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Gauge}
            /* SectionHead takes Icon3DTone, which has no "accent" — "slate" carries UNMEASURED. */
            tone={
              !acceptanceKnown ? "slate" : acceptance >= 40 ? "success" : acceptance > 0 ? "warning" : "danger"
            }
            title="Dispatch pulse"
            subtitle="Partner take rate versus exhausted jobs"
          />
          <div className="mb-pulse">
            <GlassRing3D
              value={acceptanceDial}
              label="Accept"
              sub={`${formatNumber(num(funnel?.accepted))} of ${formatNumber(num(funnel?.created) || num(health?.totalJobs))}`}
              tone={acceptTone}
            />
            <div className="mb-meters">
              <MeterBar
                label="Acceptance"
                value={acceptanceDial}
                tone={acceptanceKnown && acceptance >= 40 ? "success" : "accent"}
              />
              <MeterBar
                label="Conversion"
                value={conversion ?? 0}
                tone={conversion != null && conversion >= 40 ? "success" : "accent"}
              />
              <MeterBar
                label="Exhausted"
                value={exhaustedShare}
                tone={exhaustedShare > 0 ? "danger" : "success"}
              />
            </div>
          </div>
          <p className="mt-3 min-w-0 truncate text-xs text-[var(--color-biz-muted)]">
            {formatNumber(attempts)} attempts · {formatNumber(autoReassigns)} auto-reassigns · avg dispatch {formatWait(metrics?.averageDispatchTimeMs, true)}
          </p>
        </div>

        <div className="cu-panel">
          <SectionHead icon={Crown} tone="warning" title="Lane mix" subtitle="Who is waiting, by membership score" />
          {mix.length > 0 ? (
            <IsoBarChart
              data={mix}
              format={(v) => formatNumber(v)}
              accent="amber"
              layout="bar"
              height={220}
              isLoading={queueQ.isLoading}
            />
          ) : queueQ.isError ? (
            <EmptyLane
              icon={Crown}
              tone="warning"
              title="Mix not in this role"
              reason="Membership buckets need queue access. The live lane above still runs."
            />
          ) : (
            <EmptyLane
              icon={Crown}
              title="No mix yet"
              reason="Platinum, gold, silver, and free counts appear once an unassigned booking is in the lane."
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Timer} tone="cyan" title="Wait lanes" subtitle="Live wait versus historical assignment" />
          <div className="pq-wait-grid">
            <WaitLane
              label="HIGH now"
              value={formatWait(q?.avgWaitHighMs, true)}
              hint={`${formatNumber(pendingHigh)} waiting`}
              hot={num(q?.avgWaitHighMs) >= HIGH_SLA_MS}
            />
            <WaitLane
              label="NORMAL now"
              value={formatWait(q?.avgWaitNormalMs, true)}
              hint={`${formatNumber(pendingNormal)} waiting`}
              hot={num(q?.avgWaitNormalMs) >= NORMAL_SLA_MS}
            />
            <WaitLane
              label="HIGH assigned"
              value={formatWait(q?.historicalAvgWaitHighMs, true)}
              hint={`${formatNumber(num(q?.totalAssignedHigh))} served`}
            />
            <WaitLane
              label="NORMAL assigned"
              value={formatWait(q?.historicalAvgWaitNormalMs, true)}
              hint={`${formatNumber(num(q?.totalAssignedNormal))} served`}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-biz-muted)]">
            {formatNumber(num(priority?.priorityServedCount))} priority-served · {premiumShare}% of all bookings were HIGH.
          </p>
        </div>

        <div className="cu-panel">
          <SectionHead icon={Sparkles} tone="cyan" title="Club ops" subtitle="Plans, cashback, live jobs, premium match" />
          <div className="mb-ops">
            <Link href="/membership" className="mb-ops__row">
              <Icon3D icon={Crown} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Membership</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Plans set the HIGH skip-the-line score
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/operations" className="mb-ops__row">
              <Icon3D icon={Radio} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Live Ops</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  {num(health?.inFlight)
                    ? `${formatNumber(num(health?.inFlight))} in flight · ${formatNumber(num(health?.pendingJobs))} pending jobs`
                    : "Assignment jobs and partner dispatch"}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/membership/cashback" className="mb-ops__row">
              <Icon3D icon={Gift} tone="success" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Cashback</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Credits land after the job completes
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/bookings" className="mb-ops__row">
              <Icon3D icon={CalendarCheck} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Premium match</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  {matchingQ.isError
                    ? "Not in this role"
                    : matchingQ.isLoading
                      ? "Loading…"
                      : `${matchRate}% of bookings premium-matched`}
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

function WaitLane({
  label,
  value,
  hint,
  hot,
}: {
  label: string;
  value: string;
  hint: string;
  hot?: boolean;
}) {
  return (
    <div className={cn("pq-wait", hot && "is-hot")}>
      <p className="cu-intel__label">{label}</p>
      <p data-stat-value className="mt-1.5 truncate text-lg font-bold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-[var(--color-biz-muted)]">{hint}</p>
    </div>
  );
}

function InspectFile({
  row,
  copied,
  onCopy,
  onClose,
}: {
  row: AdminQueueBooking;
  copied: "booking" | "id" | null;
  onCopy: (value: string, kind: "booking" | "id") => void;
  onClose: () => void;
}) {
  const high = isHigh(row);
  const stale = isStale(row);

  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("cu-avatar cu-avatar--lg pq-avatar", high && "is-high", stale && "is-stale")}>
            {initials(row.user || row.service)}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold tracking-tight">{row.bookingNumber}</h2>
              <StatusBadge status={laneOf(row)} />
              {stale ? <StatusBadge status="stale" /> : null}
            </div>
            <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">{row.user || "Member"}</p>
            <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">{row.service || "Service"}</p>
          </div>
        </div>
        <button type="button" className="biz-btn !px-2.5" onClick={onClose} aria-label="Close file">
          <X size={14} />
        </button>
      </div>

      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Queued booking details">
        <dl className="cu-dock__stats">
          <div className="cu-stat">
            <dt>Wait</dt>
            <dd>{formatWait(waitMs(row), false)}</dd>
          </div>
          <div className="cu-stat">
            <dt>ETA</dt>
            <dd>{etaLabel(row)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Position</dt>
            <dd>#{row.queuePosition ?? row.position}</dd>
          </div>
          <div className="cu-stat">
            <dt>Score</dt>
            <dd>{row.priorityScore ?? "—"}</dd>
          </div>
        </dl>

        <div className="cu-intel">
          <p className="cu-intel__label">Timeline</p>
          <div className="cu-intel__rows">
            <div>
              <span>Queued</span>
              <strong className="truncate">{queuedLabel(row.queuedAt)}</strong>
            </div>
            <div>
              <span>Scheduled</span>
              <strong className="truncate">{slotLabel(row.scheduledDate)}</strong>
            </div>
          </div>
        </div>

        <div className="cb-note pq-note">
          <p className="cu-intel__label">What this row is</p>
          <p>{laneCopy(row)}</p>
        </div>
      </div>

      <div className="cu-dock__actions">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Link href={`/bookings?q=${encodeURIComponent(row.bookingNumber)}`} className="biz-btn text-xs">
            Booking
          </Link>
          <Link href="/operations" className="biz-btn text-xs">
            Live Ops
          </Link>
          <button type="button" className="biz-btn text-xs" onClick={() => onCopy(row.bookingNumber, "booking")}>
            <Copy size={13} />
            {copied === "booking" ? "Copied" : "Number"}
          </button>
          <button type="button" className="biz-btn text-xs" onClick={() => onCopy(row.bookingId, "id")}>
            <Copy size={13} />
            {copied === "id" ? "Copied" : "ID"}
          </button>
        </div>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}
