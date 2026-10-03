"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  Copy,
  FilterX,
  LifeBuoy,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Timer,
  Truck,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import {
  adminKeys,
  useAdminAnalyticsQuery,
  useAdminBookingsQuery,
  useAdminDashboardQuery,
  useAdminOpsMapQuery,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import { OPS_MAP_POLL_MS } from "@/lib/query-polling";
import { adminApi } from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import type { AdminBooking } from "@/types/admin";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "live" | "pending" | "in_progress" | "completed" | "cancelled";
type PaymentFilter = "all" | "paid" | "unpaid" | "refunded";
type SortKey = "recent" | "scheduled" | "amount";
type ConfirmAction = "cancel" | "complete";

const LIVE_STATUSES = new Set(["pending", "accepted", "assigned", "en_route", "in_progress"]);
/**
 * The didn't-happen lane. `expired` belongs here so an expired booking is never missing from every
 * lane at once — admin diagnostics still show its real status on the row, not "Cancelled".
 */
const CANCELLED_STATUSES = new Set(["cancelled_by_user", "cancelled_by_provider", "rejected", "cancelled", "expired", "customer_no_show", "provider_no_show"]);
const OPEN_PAY = new Set(["pending", "initiated", "processing"]);

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/operations", label: "Live Ops" },
  { href: "/eta-intelligence", label: "ETA" },
  { href: "/reviews", label: "Reviews" },
  { href: "/support", label: "Support" },
] as const;

const STATUS_LANES: Array<[StatusFilter, string]> = [
  ["all", "All"],
  ["live", "Live"],
  ["pending", "Pending"],
  ["in_progress", "On job"],
  ["completed", "Done"],
  ["cancelled", "Cancelled"],
];

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function rows(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" && v.trim() ? v : d;
}

function isLive(status?: string) {
  return LIVE_STATUSES.has((status || "").toLowerCase());
}

function isCancelled(status?: string) {
  return CANCELLED_STATUSES.has((status || "").toLowerCase());
}

function isOpenPay(status?: string) {
  return OPEN_PAY.has((status || "").toLowerCase());
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

function relWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d)) return formatDate(iso);
  if (d < 0) return slotLabel(iso);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return formatDate(iso);
}

function bookingCode(b: Pick<AdminBooking, "bookingNumber" | "id">) {
  return b.bookingNumber || b.id.slice(0, 8);
}

function bookingBrief(input: {
  total: number;
  live: number;
  completed: number;
  cancelled: number;
  today: number;
  completion: number;
  cancellation: number;
}) {
  const { total, live, completed, cancelled, today, completion, cancellation } = input;

  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The bookings ledger is live, but no jobs have been placed yet. Empty is a new marketplace — not a broken page.",
      impact: "Live ops, ETA, and reviews have nothing to rank until the first customer books.",
      action: "Keep Marketplace HQ publishing. The first booking will land here with schedule and payment.",
    };
  }
  if (live >= 8 || cancellation >= 25) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        cancellation >= 25
          ? `Cancellation is ${cancellation.toFixed(0)}%. Demand is leaking before completion.`
          : `${live} jobs are live right now. Dispatch and ETA are carrying the floor.`,
      impact: `${formatNumber(live)} live · ${formatNumber(today)} today · done ${completion.toFixed(0)}%.`,
      action: live >= 8 ? "Inspect the oldest live job. Dispatch or complete before the slot slips." : "Open cancelled jobs and the partner file — do not scale demand on a leaky funnel.",
    };
  }
  if (live > 0 || cancelled > 0 || (completion > 0 && completion < 70)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        live > 0
          ? `${live} live job${live === 1 ? "" : "s"} still need a partner on the ground.`
          : completion > 0 && completion < 70
            ? `Completion is ${completion.toFixed(0)}%. Too many jobs are stopping short of done.`
            : `${formatNumber(cancelled)} cancelled jobs sit on the ledger.`,
      impact: `${formatNumber(total)} booked · ${formatNumber(completed)} done · ${formatNumber(today)} today.`,
      action: live > 0 ? "Open Live, inspect the file, and dispatch or complete from the dock." : "Review cancelled jobs and payment before pushing campaigns.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Live load, completion, and cancellations are in range. The booking floor is not the constraint.",
    impact: `${formatNumber(completed)} of ${formatNumber(total)} done · ${formatNumber(today)} today.`,
    action: "Keep Live Ops and Document Review clean. No booking-ledger action required.",
  };
}

function PersonMini({
  name,
  email,
  meta,
  value,
  live,
  onOpen,
}: {
  name: string;
  email?: string;
  meta?: string;
  value: string;
  live?: boolean;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className={cn("cu-avatar bk-avatar", live && "is-live")} aria-hidden>
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
          {[email, meta].filter(Boolean).join(" · ") || "—"}
        </p>
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

function EmptyLane({
  icon: Icon,
  tone = "cyan",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof CalendarCheck;
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
  { icon: CalendarCheck, tone: "cyan" as const, title: "Slot", copy: "Scheduled window and city" },
  { icon: Wallet, tone: "success" as const, title: "Payment", copy: "Amount, paid, refund" },
  { icon: Truck, tone: "warning" as const, title: "Dispatch", copy: "Partner, ETA, live status" },
  { icon: BadgeCheck, tone: "success" as const, title: "Close", copy: "Complete or cancel with notes" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={CalendarCheck} tone="cyan" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Job file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a booking — or use ↑ ↓ — to open schedule, payment, and dispatch.
            </p>
          </div>
        </div>
      </div>

      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Job file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected job</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The ledger is empty — new bookings land on the left first"}
            </p>
          </div>
        </div>

        <dl className="cu-dock__stats">
          {[
            ["Amount", "—"],
            ["Slot", "—"],
            ["Payment", "—"],
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

export default function BookingsPage() {
  const secondary = useAfterFirstPaint();
  const dashboard = useAdminDashboardQuery({ enabled: secondary });
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : "",
  );
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"id" | "code" | null>(null);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      payment: paymentFilter === "all" ? undefined : paymentFilter,
      sort: sort === "recent" ? undefined : sort,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [debouncedSearch, endDate, page, paymentFilter, sort, startDate, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminBookingsQuery(params);
  const liveQ = useAdminBookingsQuery({ page: 1, limit: 1, status: "live", poll: false }, { enabled: secondary });
  const cancelledQ = useAdminBookingsQuery(
    { page: 1, limit: 1, status: "cancelled", poll: false },
    { enabled: secondary },
  );
  const analytics = useAdminAnalyticsQuery({}, { enabled: secondary });
  const opsQ = useAdminOpsMapQuery(OPS_MAP_POLL_MS, { enabled: secondary });

  const kpisQ = useQuery({
    queryKey: ["hq", "bookings", "exec-kpis"],
    queryFn: () => adminApi.geoIntel.execKpis(),
    staleTime: 60_000,
    retry: 1,
    enabled: secondary,
  });
  const workforceQ = useQuery({
    queryKey: ["admin", "workforce"],
    queryFn: () => adminApi.workforceAnalytics(),
    staleTime: 30_000,
    retry: 1,
    enabled: secondary,
  });
  const detailQ = useQuery({
    queryKey: ["admin", "booking-detail", selectedId],
    queryFn: () => adminApi.getBookingDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const [confirmTarget, setConfirmTarget] = useState<{
    booking: AdminBooking;
    action: ConfirmAction;
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const actionMut = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: ConfirmAction; reason: string }) => {
      if (action === "cancel") return adminApi.adminCancelBooking(id, reason);
      return adminApi.adminCompleteBooking(id, reason);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: adminKeys.dashboard });
      void qc.invalidateQueries({ queryKey: adminKeys.opsMap });
    },
  });

  const bookings = useMemo(() => data?.bookings ?? [], [data?.bookings]);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;
  const filtersOn =
    Boolean(debouncedSearch) ||
    statusFilter !== "all" ||
    paymentFilter !== "all" ||
    sort !== "recent" ||
    Boolean(startDate) ||
    Boolean(endDate);

  useEffect(() => {
    if (selectedId && !bookings.some((b) => b.id === selectedId) && !isFetching) {
      setSelectedId(null);
    }
  }, [bookings, isFetching, selectedId]);

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
      if (typing || bookings.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? bookings.findIndex((b) => b.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(bookings.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(bookings[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bookings, selectedId]);

  const totalBookings = dashboard.data?.stats.totalBookings ?? data?.total ?? 0;
  const completedBookings = dashboard.data?.stats.completedBookings ?? 0;
  const liveCount = liveQ.data?.total ?? 0;
  const cancelledCount = cancelledQ.data?.total ?? analytics.data?.overview.cancelledBookings ?? 0;
  const todayCount = kpisQ.data?.data.bookingsToday ?? dashboard.data?.charts.bookingsByDay.at(-1)?.count ?? 0;
  const completionPct =
    kpisQ.data?.data.completionRate ??
    (totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 1000) / 10 : 0);
  const cancellationPct = kpisQ.data?.data.cancellationRate ?? 0;

  const brief = bookingBrief({
    total: totalBookings,
    live: liveCount,
    completed: completedBookings,
    cancelled: cancelledCount,
    today: todayCount,
    completion: completionPct,
    cancellation: cancellationPct,
  });

  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const volumeSeries = useMemo(
    () => (dashboard.data?.charts.bookingsByDay ?? []).map((row) => ({ label: row.date.slice(5), value: row.count })),
    [dashboard.data?.charts.bookingsByDay],
  );

  const pageGmv = bookings.reduce((s, b) => s + (b.amount || 0), 0);
  const unpaidOnPage = bookings.filter((b) => isOpenPay(b.paymentStatus)).length;
  const liveOnPage = bookings.filter((b) => isLive(b.status)).length;

  const serviceMix = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const b of bookings) {
      const cur = map.get(b.service) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += b.amount || 0;
      map.set(b.service, cur);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [bookings]);

  const pipeline = useMemo(() => {
    const raw = workforceQ.data?.jobsByStatus ?? [];
    const wanted = ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"];
    const by = new Map(raw.map((r) => [r.status.toUpperCase(), r.count]));
    return wanted.map((status) => ({
      status: status.toLowerCase(),
      count: by.get(status) ?? 0,
    }));
  }, [workforceQ.data?.jobsByStatus]);

  const opsAlerts = opsQ.data?.alerts ?? [];
  const opsLive = opsQ.data?.bookings ?? [];

  const fetching =
    isFetching ||
    liveQ.isFetching ||
    cancelledQ.isFetching ||
    dashboard.isFetching ||
    opsQ.isFetching ||
    workforceQ.isFetching ||
    kpisQ.isFetching;

  const refresh = () => {
    void refetch();
    void liveQ.refetch();
    void cancelledQ.refetch();
    void dashboard.refetch();
    void opsQ.refetch();
    void workforceQ.refetch();
    void kpisQ.refetch();
    void analytics.refetch();
    if (selectedId) void detailQ.refetch();
  };

  const copyText = async (value: string, kind: "id" | "code") => {
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
    setPaymentFilter("all");
    setSort("recent");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const openFromList = (query?: string, id?: string) => {
    if (query) setSearch(query);
    setStatusFilter("all");
    setPaymentFilter("all");
    setSort("recent");
    setPage(1);
    if (id) setSelectedId(id);
  };

  const detail = rec(detailQ.data);
  const timeline = rows(detail.timeline);
  const tickets = rows(detail.supportTickets);
  const selectedLive = selected ? isLive(selected.status) : false;

  return (
    <div className="exec-hq cu-page bk-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={CalendarCheck} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Bookings</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Live jobs
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Schedule, payment, dispatch, and completion for every marketplace job — inspect one file at a time.
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
          label="Bookings"
          value={formatNumber(totalBookings)}
          sub={todayCount ? `${formatNumber(todayCount)} today` : "lifetime ledger"}
          icon={CalendarCheck}
          loading={dashboard.isLoading}
        />
        <StatTile
          label="Live now"
          value={formatNumber(liveCount)}
          sub={opsQ.data ? `${formatNumber(opsQ.data.metrics.activeBookings)} on the map` : "pending through on-job"}
          icon={Radio}
          loading={liveQ.isLoading}
          tone={liveCount > 0 ? "accent" : "success"}
        />
        <StatTile
          label="Completed"
          value={formatNumber(completedBookings)}
          sub={completionPct ? `${completionPct.toFixed(0)}% close rate` : "jobs closed"}
          icon={BadgeCheck}
          loading={dashboard.isLoading}
          tone="success"
        />
        <StatTile
          label="Today"
          value={formatNumber(todayCount)}
          sub={cancelledCount ? `${formatNumber(cancelledCount)} cancelled lifetime` : "created in this window"}
          icon={Sparkles}
          loading={kpisQ.isLoading && dashboard.isLoading}
          tone={todayCount > 0 ? "accent" : "default"}
        />
      </section>

      {(liveCount > 0 || opsAlerts.length > 0 || unpaidOnPage > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {liveCount > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "live" && "is-on")}
              onClick={() => {
                setStatusFilter("live");
                setPage(1);
              }}
            >
              <Radio size={14} />
              {liveCount} live
            </button>
          ) : null}
          {opsAlerts.length > 0 ? (
            <Link href="/operations" className="cu-rail__chip is-hot">
              <Timer size={14} />
              {opsAlerts.length} ops alerts
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {unpaidOnPage > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip", paymentFilter === "unpaid" && "is-on")}
              onClick={() => {
                setPaymentFilter("unpaid");
                setPage(1);
              }}
            >
              <Wallet size={14} />
              {unpaidOnPage} unpaid on page
            </button>
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
                  {pageGmv > 0 ? ` · ${inr(pageGmv, true)} on this page` : ""}
                  {liveOnPage > 0 ? ` · ${liveOnPage} live here` : ""}
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
                placeholder="Booking #, customer, partner, service…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Lane">
                {STATUS_LANES.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      setPage(1);
                      setStatusFilter(key);
                    }}
                    className={cn("cu-chip", statusFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Payment">
                {(
                  [
                    ["all", "All"],
                    ["paid", "Paid"],
                    ["unpaid", "Open"],
                    ["refunded", "Refund"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      setPage(1);
                      setPaymentFilter(key);
                    }}
                    className={cn("cu-chip", paymentFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                {(
                  [
                    ["recent", "Booked"],
                    ["scheduled", "Slot"],
                    ["amount", "Amount"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      setPage(1);
                      setSort(key);
                    }}
                    className={cn("cu-chip", sort === key && "is-on")}
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
                  className="bk-date-input"
                  aria-label="From date"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setPage(1);
                    setEndDate(e.target.value);
                  }}
                  className="bk-date-input"
                  aria-label="To date"
                />
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
                <p className="text-sm">Could not load bookings.</p>
                <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : bookings.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={CalendarCheck}
                  title={filtersOn ? "No match" : "Ledger is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search, lane, payment, or dates."
                      : "The first customer booking will appear here with slot, partner, and payment."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {bookings.map((b) => {
                  const on = selectedId === b.id;
                  const live = isLive(b.status);
                  const cancelled = isCancelled(b.status);
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : b.id)}
                        className={cn("cu-row bk-row", on && "is-on", live && "is-live", cancelled && "is-cancelled")}
                      >
                        <span className={cn("cu-avatar bk-avatar", live && "is-live", cancelled && "is-cancelled")} aria-hidden>
                          {initials(b.user)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-mono text-[0.85rem] font-semibold tracking-tight">
                              {bookingCode(b)}
                            </p>
                            {live ? (
                              <span className="bk-live">
                                <span className="bk-live__dot" aria-hidden />
                                Live
                              </span>
                            ) : null}
                            {b.premiumMatched ? <span className="bk-premium">Priority</span> : null}
                            <StatusBadge status={b.status} />
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{b.user}</span>
                            <span className="truncate">{b.service}</span>
                            {b.city ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={11} />
                                {b.city}
                              </span>
                            ) : null}
                            <span>{slotLabel(b.scheduledDate)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{inr(b.amount, true)}</p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                            {b.provider}
                            {b.rating ? ` · ${Number(b.rating).toFixed(1)}★` : ""}
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
                  <span className={cn("cu-avatar cu-avatar--lg bk-avatar", selectedLive && "is-live", isCancelled(selected.status) && "is-cancelled")}>
                    {initials(selected.user)}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">Job file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-mono text-lg font-bold tracking-tight">{bookingCode(selected)}</h2>
                      {selectedLive ? (
                        <span className="bk-live">
                          <span className="bk-live__dot" aria-hidden />
                          Live
                        </span>
                      ) : (
                        <StatusBadge status={selected.status} />
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">
                      {selected.user} · {selected.service}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Booked {relWhen(selected.createdAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={selected.status} />
                      {selected.paymentStatus ? <StatusBadge status={selected.paymentStatus} /> : null}
                      {selected.city ? (
                        <span className="cu-chip is-on">
                          <MapPin size={11} />
                          {selected.city}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <button type="button" className="biz-btn !px-2.5" onClick={() => setSelectedId(null)} aria-label="Close inspect">
                  <X size={14} />
                </button>
              </div>

              <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Booking details">
                <dl className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Amount</dt>
                    <dd data-stat-value>{inr(selected.amount, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Slot</dt>
                    <dd data-stat-value>{slotLabel(selected.scheduledDate)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Payment</dt>
                    <dd data-stat-value className="capitalize">
                      {(selected.paymentStatus ?? "—").replace(/_/g, " ")}
                    </dd>
                  </div>
                  <div className="cu-stat">
                    <dt>ETA</dt>
                    <dd data-stat-value>{selected.eta ? `${selected.eta}m` : "—"}</dd>
                  </div>
                </dl>

                <div className="cu-intel">
                  <p className="cu-intel__label">Run sheet</p>
                  {detailQ.isLoading ? (
                    <div className="biz-skeleton mt-4 h-28 rounded-xl" />
                  ) : (
                    <>
                      <dl className="cu-intel__rows">
                        <div>
                          <dt>Partner</dt>
                          <dd>{selected.provider}</dd>
                        </div>
                        <div>
                          <dt>Priority</dt>
                          <dd className="capitalize">{(selected.queuePriority ?? "normal").replace(/_/g, " ")}</dd>
                        </div>
                        <div>
                          <dt>Rating</dt>
                          <dd>
                            {selected.rating ? (
                              <span className="inline-flex items-center gap-1">
                                <Star size={11} />
                                {Number(selected.rating).toFixed(1)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Tickets</dt>
                          <dd>{tickets.length ? formatNumber(tickets.length) : "none"}</dd>
                        </div>
                      </dl>
                      {selected.premiumMatched ? (
                        <p className="mt-3 text-xs leading-relaxed text-[var(--color-biz-accent)]">
                          Priority match — this job was served from the premium queue.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {timeline.length > 0 ? (
                  <div className="bk-timeline">
                    <p className="cu-intel__label">Timeline</p>
                    <ol>
                      {timeline.slice(-6).map((ev, i) => (
                        <li key={`${str(ev.at)}-${i}`}>
                          <span>{str(ev.label, str(ev.type, "Event"))}</span>
                          <em>{relWhen(str(ev.at) || null)}</em>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <div className="cu-jump-row">
                  <Link href={`/bookings/${selected.id}`} className="biz-btn text-xs">
                    <Navigation size={13} />
                    Full file
                  </Link>
                  {selected.userId ? (
                    <Link href={`/customers?q=${encodeURIComponent(selected.user)}`} className="biz-btn text-xs">
                      Customer
                    </Link>
                  ) : null}
                  {selected.providerId ? (
                    <Link href={`/vendors/${selected.providerId}`} className="biz-btn text-xs">
                      Partner
                    </Link>
                  ) : null}
                  {tickets.length > 0 ? (
                    <Link href="/support" className="biz-btn text-xs">
                      <LifeBuoy size={13} />
                      Support
                    </Link>
                  ) : null}
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyText(bookingCode(selected), "code")}>
                    <Copy size={13} />
                    {copied === "code" ? "Copied" : "Number"}
                  </button>
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyText(selected.id, "id")}>
                    <Copy size={13} />
                    {copied === "id" ? "Copied" : "ID"}
                  </button>
                </div>
              </div>

              <div className="cu-dock__actions">
                {selectedLive ? (
                  <>
                    <button
                      type="button"
                      className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
                      disabled={actionMut.isPending}
                      onClick={() => setConfirmTarget({ booking: selected, action: "complete" })}
                    >
                      <BadgeCheck size={14} />
                      Mark complete
                    </button>
                    <button
                      type="button"
                      className="biz-btn w-full justify-center text-[var(--color-biz-danger)]"
                      disabled={actionMut.isPending}
                      onClick={() => setConfirmTarget({ booking: selected, action: "cancel" })}
                    >
                      <XCircle size={14} />
                      Cancel job
                    </button>
                  </>
                ) : (
                  <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
                )}
              </div>
            </div>
          ) : (
            <InspectIdle matching={data?.total ?? bookings.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor bk-floor">
        <div className="cu-panel">
          <SectionHead
            icon={CalendarCheck}
            tone={completionPct >= 70 ? "success" : "warning"}
            title="Pulse"
            subtitle="Close rate and seven-day volume"
          />
          <div className="bk-pulse">
            <GlassRing3D
              value={Math.round(completionPct)}
              label="Done"
              sub={`${formatNumber(completedBookings)} of ${formatNumber(totalBookings)}`}
              tone={completionPct >= 70 ? "success" : completionPct >= 40 ? "warning" : "danger"}
            />
            <div className="bk-meters">
              <MeterBar
                label="Completion"
                value={completionPct}
                tone={completionPct >= 70 ? "success" : completionPct >= 40 ? "accent" : "danger"}
              />
              <MeterBar
                label="Cancellation"
                value={cancellationPct}
                tone={cancellationPct >= 25 ? "danger" : cancellationPct >= 10 ? "accent" : "success"}
              />
              <MeterBar
                label="Unpaid on page"
                value={bookings.length ? (unpaidOnPage / bookings.length) * 100 : 0}
                tone={unpaidOnPage > 0 ? "danger" : "success"}
              />
            </div>
          </div>
          <div className="bk-chart">
            <p className="cu-intel__label mb-3">Volume · 7d</p>
            <IsoBarChart
              data={volumeSeries}
              format={formatNumber}
              accent="blue"
              layout="area"
              height={156}
              isLoading={dashboard.isLoading}
            />
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Radio}
            tone={opsAlerts.length > 0 ? "danger" : liveCount > 0 ? "cyan" : "success"}
            title="Live board"
            subtitle="Active jobs and ops alerts on the map"
            action={
              <Link href="/operations" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Live Ops
              </Link>
            }
          />
          {opsQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : opsQ.isError ? (
            <EmptyLane icon={Radio} tone="cyan" title="Map not in this role" reason="Live ops markers need operations access. The ledger above still runs." href="/operations" cta="Live Ops" />
          ) : opsAlerts.length > 0 || opsLive.length > 0 ? (
            <div className="space-y-2">
              {opsAlerts.slice(0, 3).map((a, i) => (
                <PersonMini
                  key={`${a.type}-${a.bookingId ?? i}`}
                  name={a.message}
                  email={a.type.replace(/_/g, " ")}
                  meta={a.severity}
                  value={a.severity}
                  live={a.severity === "critical"}
                  onOpen={a.bookingId ? () => openFromList(a.bookingId, a.bookingId) : undefined}
                />
              ))}
              {opsLive.slice(0, 4).map((b) => (
                <PersonMini
                  key={b.bookingId}
                  name={b.status.replace(/_/g, " ")}
                  email={b.bookingId.slice(0, 8)}
                  meta={b.eta ? `ETA ${b.eta}m` : undefined}
                  value={b.eta ? `${b.eta}m` : "Live"}
                  live
                  onOpen={() => openFromList(b.bookingId, b.bookingId)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Radio} tone="success" title="Floor is quiet" reason="No active map jobs or alerts. New live bookings will pulse here." href="/operations" cta="Live Ops" />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Truck}
            tone="cyan"
            title="Pipeline"
            subtitle="Workforce jobs by status"
            action={
              <Link href="/workforce" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Workforce
              </Link>
            }
          />
          {workforceQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : workforceQ.isError ? (
            <EmptyLane icon={Truck} title="Pipeline not in this role" reason="Status mix comes from workforce analytics. Filter Live and On job on the ledger instead." />
          ) : pipeline.some((p) => p.count > 0) ? (
            <div className="space-y-3">
              {pipeline.map((p) => {
                const max = Math.max(1, ...pipeline.map((x) => x.count));
                return (
                  <MeterBar
                    key={p.status}
                    label={p.status.replace(/_/g, " ")}
                    value={p.count}
                    max={max}
                    suffix=""
                    tone={p.status === "completed" ? "success" : "accent"}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={Truck} tone="cyan" title="No pipeline yet" reason="Jobs grouped by status will rank here once partners start accepting." href="/workforce" cta="Workforce" />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Wallet}
            tone="success"
            title="This page"
            subtitle="Services and GMV on the current ledger"
          />
          {serviceMix.length > 0 ? (
            <div>
              <p className="mb-3 text-xs text-[var(--color-biz-muted)]">
                {inr(pageGmv, true)} across {formatNumber(bookings.length)} rows
              </p>
              {serviceMix.map((s) => {
                const max = Math.max(1, ...serviceMix.map((x) => x.count));
                return (
                  <div key={s.name} className="bk-city">
                    <span className="max-w-[8.5rem] shrink-0 truncate text-sm font-semibold">{s.name}</span>
                    <div className="bk-city__bar" aria-hidden>
                      <span style={{ width: `${Math.max(8, (s.count / max) * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right text-xs font-bold tabular-nums">{s.count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={Wallet} title="No mix on this page" reason="Service share appears once the ledger has rows." />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.action === "complete" ? "Mark this job complete?" : "Cancel this job?"}
        description={
          confirmTarget
            ? confirmTarget.action === "complete"
              ? `${bookingCode(confirmTarget.booking)} will be closed as completed. This writes an admin audit event.`
              : `${bookingCode(confirmTarget.booking)} will be cancelled. The customer and partner will be notified.`
            : undefined
        }
        confirmLabel={confirmTarget?.action === "complete" ? "Mark complete" : "Cancel job"}
        destructive={confirmTarget?.action === "cancel"}
        reasonLabel="Reason"
        reasonRequired
        reasonPlaceholder={
          confirmTarget?.action === "complete" ? "e.g. Partner confirmed on site" : "e.g. Customer requested cancel"
        }
        isLoading={actionMut.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (reason) => {
          if (!confirmTarget) return;
          setMutationError(null);
          try {
            await actionMut.mutateAsync({
              id: confirmTarget.booking.id,
              action: confirmTarget.action,
              reason: reason?.trim() || (confirmTarget.action === "complete" ? "Admin complete" : "Admin cancel"),
            });
            setConfirmTarget(null);
          } catch (error) {
            setMutationError(getErrorMessage(error));
          }
        }}
      />
    </div>
  );
}
