"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck,
  Coins,
  Crown,
  ExternalLink,
  FileText,
  LayoutGrid,
  MapPin,
  RefreshCw,
  Sparkles,
  Star,
  Store,
  TrendingDown,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { adminApi } from "@/services/admin-api";
import {
  useAdminDashboardQuery,
  useAdminOpsMapQuery,
  useAdminReviewsQuery,
  useAdminServicesQuery,
} from "@/hooks/use-admin-data";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { StatTile } from "../primitives";
import { SectionHead } from "../SectionHead";
import { Icon3D, type Icon3DTone } from "../Icon3D";
import { IsoBarChart } from "../IsoBarChart";
import { GlassRing3D } from "../GlassRing3D";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" && v.trim() ? v : d;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function rows(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
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
  const ms = new Date(String(iso)).getTime() - Date.now();
  const d = Math.ceil(ms / 86_400_000);
  if (!Number.isFinite(d)) return "expiring";
  if (d <= 0) return "expires today";
  if (d === 1) return "1 day left";
  return `${d} days left`;
}

function stars(n: number) {
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return `${"★".repeat(r)}${"☆".repeat(5 - r)}`;
}

function chartLabel(date: string) {
  const d = date.slice(5);
  return d || date.slice(-5);
}

function marketBrief(input: {
  customers: number;
  partners: number;
  online: number;
  bookings: number;
  today: number;
  gaps: number;
  pendingDocs: number;
  churnN: number;
  rating: number;
  completion: number;
  flagged: number;
}) {
  const { customers, partners, online, bookings, today, gaps, pendingDocs, churnN, rating, completion, flagged } =
    input;

  if (customers === 0 && partners === 0 && bookings === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning:
        "The marketplace ledger is live, but no customers, partners, or bookings have landed yet. This is an empty network — not a broken dashboard.",
      impact:
        "HQ metrics stay at zero until the first partner is verified and the first booking completes. Membership, zones, and reviews have nothing to rank.",
      action: "Publish the catalog, clear Document Review, onboard partners, then invite the first customers.",
    };
  }

  if (pendingDocs >= 5 || gaps >= 5 || flagged >= 3) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        pendingDocs >= 5
          ? `${pendingDocs} partner documents are waiting on review. Supply cannot expand until KYC clears.`
          : flagged >= 3
            ? `${flagged} reviews are flagged. Trust on the catalog is under pressure.`
            : `${gaps} service-gap zones are uncovered. Demand in those areas will not convert.`,
      impact: `${online} of ${partners} partners online · ${today} bookings today · ${completion}% completion.`,
      action:
        pendingDocs >= 5
          ? "Open Document Review and clear the KYC queue before pushing demand."
          : flagged >= 3
            ? "Moderate flagged reviews, then check the partners behind them."
            : "Open Geo Command, add coverage, or stage partners into gap zones.",
    };
  }

  if (churnN > 0 || gaps > 0 || pendingDocs > 0 || (rating > 0 && rating < 4)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        churnN > 0
          ? `${churnN} members expire within 7 days. That is the churn-risk list — not a probability model.`
          : pendingDocs > 0
            ? `${pendingDocs} KYC pack${pendingDocs === 1 ? "" : "s"} still sit in Document Review.`
            : rating > 0 && rating < 4
              ? `Average rating is ${rating.toFixed(1)}★. Catalog trust is below the 4.0 bar.`
              : `${gaps} zone${gaps === 1 ? "" : "s"} show a service gap.`,
      impact: `${formatNumber(customers)} customers · ${online} online partners · ${completion}% completion.`,
      action:
        churnN > 0
          ? "Reach expiring members from Membership before the window closes."
          : pendingDocs > 0
            ? "Verify or reject pending partner documents today."
            : "Fix the gap or the rating — do not scale demand on a thin network.",
    };
  }

  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Supply, demand, and trust are in range. The marketplace is not the constraint.",
    impact: `${formatNumber(customers)} customers · ${online}/${partners} partners online · ${today} bookings today.`,
    action: "Keep Document Review clear and watch membership expiry. No marketplace action required.",
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
  icon: typeof Store;
  tone?: Icon3DTone;
  title: string;
  reason: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mp-empty">
      <Icon3D icon={Icon} size="md" tone={tone} />
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-[var(--color-biz-muted)]">{reason}</p>
      {href && cta ? (
        <Link href={href} className="biz-btn biz-btn-primary mt-1 text-xs [&_svg]:text-white">
          {cta}
          <ArrowUpRight size={13} />
        </Link>
      ) : null}
    </div>
  );
}

function PersonRow({
  name,
  email,
  meta,
  value,
  tone = "accent",
}: {
  name: string;
  email?: string;
  meta?: string;
  value: string;
  tone?: "accent" | "danger" | "muted";
}) {
  return (
    <div className="mp-person">
      <span className="mp-avatar" aria-hidden>
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
          {[email, meta].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-bold tabular-nums",
          tone === "danger"
            ? "text-[var(--color-biz-danger)]"
            : tone === "muted"
              ? "text-[var(--color-biz-muted)]"
              : "text-[var(--color-biz-accent)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function LaneCard({
  icon: Icon,
  tone,
  title,
  value,
  sub,
  href,
  meter,
  meterTone,
}: {
  icon: typeof Store;
  tone: Icon3DTone;
  title: string;
  value: string;
  sub: string;
  href: string;
  meter?: number;
  meterTone?: "success" | "warning" | "danger";
}) {
  return (
    <Link href={href} className={cn("dt-layer group", `dt-layer--${tone}`)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">{title}</p>
          <p data-stat-value className="dt-layer__value">
            {value}
          </p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{sub}</p>
        </div>
        <Icon3D icon={Icon} size="sm" tone={tone} />
      </div>
      {meter != null ? (
        <div
          className={cn(
            "biz-meter mt-3",
            meterTone === "warning" ? "biz-meter--warning" : meterTone === "danger" ? "biz-meter--danger" : "biz-meter--success",
          )}
        >
          <span style={{ width: `${Math.max(6, Math.min(100, meter))}%` }} />
        </div>
      ) : null}
      <div className="dt-layer__meta flex items-center justify-between text-[11px] font-semibold text-[var(--color-biz-accent)]">
        Open
        <ArrowUpRight size={12} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-[var(--color-biz-muted)]">{label}</span>
      <span data-stat-value className="text-[11px] font-bold tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function MarketplaceHqDashboard() {
  const dashboard = useAdminDashboardQuery();
  const opsMap = useAdminOpsMapQuery();
  const reviewsQ = useAdminReviewsQuery({ page: 1, limit: 6 });
  const catalogQ = useAdminServicesQuery({ page: 1, limit: 8 });

  const insights = useQuery({
    queryKey: ["hq", "marketplace", "insights"],
    queryFn: () => adminApi.subscriptions.insights(),
    staleTime: 120_000,
  });
  const zones = useQuery({
    queryKey: ["hq", "marketplace", "zone-scoring"],
    queryFn: () => adminApi.geoIntel.zoneScoring(),
    staleTime: 120_000,
  });
  const execKpis = useQuery({
    queryKey: ["hq", "marketplace", "exec-kpis"],
    queryFn: () => adminApi.geoIntel.execKpis(),
    staleTime: 60_000,
  });
  const docsQ = useQuery({
    queryKey: ["hq", "marketplace", "pending-docs"],
    queryFn: () => adminApi.pendingDocuments(),
    staleTime: 30_000,
  });

  const stats = dashboard.data?.stats;
  const charts = dashboard.data?.charts;
  const kpis = execKpis.data?.data;
  const metrics = opsMap.data?.metrics;
  const ins = rec(insights.data);
  const analytics = rec(ins.analytics);

  const vip = rows(ins.highValueMembers);
  const churnRisk = rows(ins.churnRiskUsers);
  const upgrades = rows(ins.upgradeRecommendations);
  const topPlans = rows(ins.topPlans);
  const topBenefits = rows(ins.topBenefits);
  const planDist = rows(analytics.planDistribution);

  const pendingDocs = docsQ.data?.documents ?? [];
  const reviews = reviewsQ.data?.reviews ?? [];
  const reviewStats = reviewsQ.data?.stats;
  const services = catalogQ.data?.services ?? [];
  const catalogTotal = catalogQ.data?.total ?? services.length;
  const flagged = reviews.filter((r) => r.isFlagged).length;

  const customers = stats?.totalUsers ?? 0;
  const partners = stats?.totalProviders ?? metrics?.totalProviders ?? 0;
  const online = stats?.activeNow ?? metrics?.onlineProviders ?? 0;
  const bookings = stats?.totalBookings ?? 0;
  const completed = stats?.completedBookings ?? 0;
  const rating = stats?.averageRating ?? reviewStats?.averageRating ?? 0;
  const today = kpis?.bookingsToday ?? 0;
  const gmv = kpis?.gmv ?? stats?.thisMonthRevenue ?? stats?.totalRevenue ?? 0;
  const gaps = metrics?.serviceGaps ?? 0;
  const completion = bookings > 0 ? Math.round((completed / bookings) * 100) : kpis?.completionRate ?? 0;
  const coverage = partners > 0 ? Math.round((online / partners) * 100) : 0;
  const ratingPct = Math.round((Math.max(0, Math.min(5, rating)) / 5) * 100);
  const mrr = num(analytics.mrr);
  const arr = num(analytics.arr);
  const retention = num(analytics.retentionRatePct);
  const churnPct = num(analytics.churnRatePct);
  const members = num(analytics.activeSubscribers);
  const avgLtv = num(analytics.avgLtv);

  const brief = marketBrief({
    customers,
    partners,
    online,
    bookings,
    today,
    gaps,
    pendingDocs: pendingDocs.length,
    churnN: churnRisk.length,
    rating,
    completion,
    flagged,
  });

  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const bookingSeries = useMemo(
    () => (charts?.bookingsByDay ?? []).slice(-14).map((d) => ({ label: chartLabel(d.date), value: d.count })),
    [charts?.bookingsByDay],
  );
  const revenueSeries = useMemo(
    () => (charts?.revenueByDay ?? []).slice(-14).map((d) => ({ label: chartLabel(d.date), value: d.revenue })),
    [charts?.revenueByDay],
  );

  const zoneBoard = zones.data?.data;
  const topZones = useMemo(() => {
    const ranked = zoneBoard?.bestEarning?.length ? zoneBoard.bestEarning : (zoneBoard?.ranked ?? []);
    return ranked.slice(0, 8);
  }, [zoneBoard]);
  const riskZones = zoneBoard?.highRisk?.slice(0, 4) ?? [];

  const planSeries = useMemo(() => {
    if (planDist.length > 0) {
      return planDist.slice(0, 6).map((p) => ({
        label: str(p.planName ?? p.name, "Plan").slice(0, 10),
        value: num(p.count ?? p.subscribers),
      }));
    }
    return topPlans.slice(0, 6).map((p) => ({
      label: str(p.name, "Plan").slice(0, 10),
      value: num(p.subscribers),
    }));
  }, [planDist, topPlans]);

  const zoneSeries = useMemo(
    () =>
      topZones.slice(0, 6).map((z) => ({
        label: z.name.slice(0, 10),
        value: z.revenue24h,
      })),
    [topZones],
  );

  const generated = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const fetching =
    dashboard.isFetching ||
    insights.isFetching ||
    zones.isFetching ||
    opsMap.isFetching ||
    execKpis.isFetching ||
    docsQ.isFetching ||
    reviewsQ.isFetching ||
    catalogQ.isFetching;

  const refresh = () => {
    void dashboard.refetch();
    void insights.refetch();
    void zones.refetch();
    void opsMap.refetch();
    void execKpis.refetch();
    void docsQ.refetch();
    void reviewsQ.refetch();
    void catalogQ.refetch();
  };

  const heroMetric = today > 0 ? today : bookings;
  const heroUnit = today > 0 ? "today" : "lifetime";

  return (
    <div className="exec-hq space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="cmd-live-pill">
            <span className="cmd-live-dot" aria-hidden />
            Live ledger
          </span>
          <span className="ops-alert-pill is-good">as of {generated}</span>
          <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
            {brief.label}
          </span>
        </div>
        <button type="button" onClick={refresh} className="biz-btn shrink-0">
          <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile
          label="Customers"
          value={formatNumber(customers)}
          sub={kpis ? `${formatNumber(kpis.activeCustomers)} active now` : "registered ledger"}
          icon={Users}
          loading={dashboard.isLoading}
        />
        <StatTile
          label="Partners"
          value={formatNumber(partners)}
          sub={`${formatNumber(online)} online`}
          icon={Wrench}
          loading={dashboard.isLoading}
          tone={online > 0 ? "success" : "default"}
        />
        <StatTile
          label="Bookings"
          value={formatNumber(bookings)}
          sub={today > 0 ? `${formatNumber(today)} today · ${completion}% done` : `${completion}% completion`}
          icon={CalendarCheck}
          loading={dashboard.isLoading}
        />
        <StatTile
          label="Avg rating"
          value={`${Number(rating || 0).toFixed(1)}★`}
          sub={reviewStats ? `${formatNumber(reviewStats.totalReviews)} reviews` : "catalog trust"}
          icon={Star}
          loading={dashboard.isLoading}
          tone={rating >= 4 ? "success" : rating > 0 ? "accent" : "default"}
        />
        <StatTile
          label="GMV"
          value={inr(gmv, true)}
          sub={kpis ? "today pulse" : "this month"}
          icon={Coins}
          loading={execKpis.isLoading && dashboard.isLoading}
          tone={gmv > 0 ? "success" : "default"}
        />
        <StatTile
          label="Membership MRR"
          value={inr(mrr, true)}
          sub={members > 0 ? `${formatNumber(members)} active · ARR ${inr(arr, true)}` : "no active plans"}
          icon={Crown}
          loading={insights.isLoading}
          tone={mrr > 0 ? "accent" : "default"}
        />
      </section>

      <section className="dt-board">
        <LaneCard
          href="/vendors/documents"
          icon={FileText}
          tone={pendingDocs.length > 0 ? "warning" : "success"}
          title="KYC queue"
          value={formatNumber(pendingDocs.length)}
          sub={pendingDocs.length > 0 ? "packs waiting on review" : "Document Review is clear"}
          meter={pendingDocs.length > 0 ? Math.min(100, pendingDocs.length * 12) : 8}
          meterTone={pendingDocs.length >= 5 ? "danger" : pendingDocs.length > 0 ? "warning" : "success"}
        />
        <LaneCard
          href="/membership"
          icon={Crown}
          tone="cyan"
          title="Members"
          value={formatNumber(members)}
          sub={churnPct > 0 ? `${churnPct}% churn this month` : "retention ledger"}
          meter={retention || (members > 0 ? 72 : 8)}
          meterTone={churnPct >= 8 ? "danger" : churnPct > 0 ? "warning" : "success"}
        />
        <LaneCard
          href="/services"
          icon={LayoutGrid}
          tone="default"
          title="Catalog"
          value={formatNumber(catalogTotal)}
          sub={services.filter((s) => s.isActive).length ? `${services.filter((s) => s.isActive).length} live on this page` : "publish services"}
          meter={catalogTotal > 0 ? Math.min(100, catalogTotal * 8) : 8}
        />
        <LaneCard
          href="/reviews"
          icon={Star}
          tone={flagged > 0 ? "danger" : "success"}
          title="Trust"
          value={`${Number(rating || 0).toFixed(1)}★`}
          sub={flagged > 0 ? `${flagged} flagged` : `${formatNumber(reviewStats?.totalReviews ?? 0)} public reviews`}
          meter={ratingPct || 8}
          meterTone={flagged > 0 ? "danger" : rating >= 4 ? "success" : "warning"}
        />
      </section>

      <section className={cn("mp-hero", `mp-hero--${brief.state}`)}>
        <div className="wx-hero__grid">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <Icon3D icon={brief.state === "critical" ? AlertTriangle : Store} size="md" tone={headerTone} />
              <span
                className={cn(
                  "ops-alert-pill",
                  brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good",
                )}
              >
                {brief.label}
              </span>
              {gaps > 0 ? <span className="ops-alert-pill is-warm">{gaps} gaps</span> : null}
              {pendingDocs.length > 0 ? <span className="ops-alert-pill is-warm">{pendingDocs.length} KYC</span> : null}
            </div>
            <h2 className="mt-4 text-[1.45rem] font-bold leading-tight tracking-tight">Marketplace pulse</h2>
            <p className="mt-1.5 text-sm text-[var(--color-biz-muted)]">
              Customers, partners, catalog, and membership on one ledger.
            </p>
            <p data-stat-value className="dt-hero__metric">
              {formatNumber(heroMetric)}
              <span>{heroUnit}</span>
            </p>
          </div>
          <dl className="wx-stat-grid">
            <div className="wx-stat">
              <dt>Online</dt>
              <dd>
                {formatNumber(online)}/{formatNumber(partners)}
              </dd>
            </div>
            <div className="wx-stat">
              <dt>Active jobs</dt>
              <dd>{formatNumber(metrics?.activeBookings ?? 0)}</dd>
            </div>
            <div className="wx-stat">
              <dt>Avg ETA</dt>
              <dd>{metrics ? `${Math.round(metrics.averageEtaMin)}m` : "—"}</dd>
            </div>
            <div className="wx-stat">
              <dt>Completion</dt>
              <dd>{completion}%</dd>
            </div>
            <div className="wx-stat">
              <dt>Retention</dt>
              <dd>{retention > 0 ? `${retention}%` : "—"}</dd>
            </div>
            <div className="wx-stat">
              <dt>Avg LTV</dt>
              <dd>{avgLtv > 0 ? inr(avgLtv, true) : "—"}</dd>
            </div>
          </dl>
          <div className="wx-brief">
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
            <div className="flex flex-wrap gap-x-4 gap-y-2 px-1 pt-1">
              <Link href="/customers" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                Customers <ExternalLink size={11} />
              </Link>
              <Link href="/vendors" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                Partners <ExternalLink size={11} />
              </Link>
              <Link href="/bookings" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                Bookings <ExternalLink size={11} />
              </Link>
              <Link href="/membership" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                Membership <ExternalLink size={11} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="biz-glass-panel p-6">
          <SectionHead icon={CalendarCheck} tone="success" title="Fulfilment" subtitle="Completed vs booked" />
          <GlassRing3D
            value={completion}
            label="Done"
            sub={`${formatNumber(completed)} of ${formatNumber(bookings)} bookings`}
            tone={completion >= 80 ? "success" : completion >= 50 ? "warning" : "danger"}
          />
        </div>
        <div className="biz-glass-panel p-6">
          <SectionHead icon={Wrench} tone={coverage >= 50 ? "success" : "warning"} title="Coverage" subtitle="Partners on the grid" />
          <GlassRing3D
            value={coverage}
            label="Online"
            sub={`${formatNumber(online)} live · ${formatNumber(metrics?.busyProviders ?? 0)} busy`}
            tone={coverage >= 50 ? "success" : coverage > 0 ? "warning" : "danger"}
          />
        </div>
        <div className="biz-glass-panel p-6">
          <SectionHead icon={Star} tone={rating >= 4 ? "success" : "cyan"} title="Trust" subtitle="Rating as a share of 5.0" />
          <GlassRing3D
            value={ratingPct}
            label="Score"
            sub={`${Number(rating || 0).toFixed(1)}★ catalog average`}
            tone={rating >= 4 ? "success" : rating > 0 ? "warning" : "accent"}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="biz-glass-panel p-6">
          <SectionHead icon={CalendarCheck} title="Booking volume" subtitle="Last 14 days on the ledger" meta="demand" />
          <IsoBarChart data={bookingSeries} format={formatNumber} accent="blue" layout="area" height={200} isLoading={dashboard.isLoading} />
        </div>
        <div className="biz-glass-panel p-6">
          <SectionHead icon={Coins} tone="success" title="Revenue pulse" subtitle="Daily GMV captured" meta="inr" />
          <IsoBarChart data={revenueSeries} format={(v) => inr(v, true)} accent="emerald" layout="area" height={200} isLoading={dashboard.isLoading} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="biz-glass-panel p-6 xl:col-span-2">
          <SectionHead
            icon={Crown}
            tone="warning"
            title="VIP / high-value members"
            subtitle="Ranked by credited cashback — not a guessed LTV"
            action={
              <Link href="/membership/cashback" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Cashback
              </Link>
            }
          />
          {insights.isLoading ? (
            <div className="biz-skeleton h-40 w-full rounded-xl" />
          ) : vip.length > 0 ? (
            <div className="space-y-1.5">
              {vip.slice(0, 6).map((v, i) => (
                <PersonRow
                  key={str(v.userId, String(i))}
                  name={str(v.name, `Member ${i + 1}`)}
                  email={str(v.email)}
                  meta="credited cashback"
                  value={inr(num(v.totalCashback))}
                />
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={Crown}
              tone="warning"
              title="No VIP ledger yet"
              reason="High-value members appear once cashback is credited. Invite members or wait for the first payouts."
              href="/membership"
              cta="Open membership"
            />
          )}
        </div>

        <div className="biz-glass-panel p-6">
          <SectionHead icon={Sparkles} tone="cyan" title="Plan mix" subtitle="Active subscribers by plan" />
          {insights.isLoading ? (
            <div className="biz-skeleton h-40 w-full rounded-xl" />
          ) : planSeries.some((p) => p.value > 0) ? (
            <IsoBarChart data={planSeries} format={formatNumber} accent="blue" layout="bar" height={220} />
          ) : (
            <EmptyLane
              icon={Crown}
              title="No active plans"
              reason="Plan mix fills when the first membership is live."
              href="/membership"
              cta="Manage plans"
            />
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={TrendingDown}
            tone="danger"
            title="Expiring members"
            subtitle="Active plans that end within 7 days"
            action={
              <Link href="/membership" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Membership
              </Link>
            }
          />
          {insights.isLoading ? (
            <div className="biz-skeleton h-40 w-full rounded-xl" />
          ) : churnRisk.length > 0 ? (
            <div className="space-y-1.5">
              {churnRisk.slice(0, 6).map((c, i) => (
                <PersonRow
                  key={str(c.userId, String(i))}
                  name={str(c.name, `Member ${i + 1}`)}
                  email={str(c.email)}
                  meta={str(c.plan)}
                  value={daysLeft(c.expiresAt)}
                  tone="danger"
                />
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={TrendingDown}
              tone="danger"
              title="No expiry window"
              reason="Churn-risk here is memberships expiring in the next 7 days — not a predicted probability."
              href="/membership"
              cta="View members"
            />
          )}
        </div>

        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={Users}
            tone="success"
            title="Upgrade opportunities"
            subtitle="High spend, no active plan"
            action={
              <Link href="/customers" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Customers
              </Link>
            }
          />
          {insights.isLoading ? (
            <div className="biz-skeleton h-40 w-full rounded-xl" />
          ) : upgrades.length > 0 ? (
            <div className="space-y-1.5">
              {upgrades.slice(0, 6).map((u, i) => (
                <PersonRow
                  key={str(u.userId, String(i))}
                  name={str(u.name, `Customer ${i + 1}`)}
                  email={str(u.email)}
                  meta="lifetime spend"
                  value={inr(num(u.totalSpent), true)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={Users}
              tone="success"
              title="No upgrade list"
              reason="Customers over ₹5,000 spend with no active membership will land here."
              href="/customers"
              cta="Open customers"
            />
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={Trophy}
            tone="warning"
            title="Zone performance"
            subtitle="Ranked by 24h earning score"
            action={
              <Link href="/geofences" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Zone Control
              </Link>
            }
          />
          {zones.isLoading ? (
            <div className="biz-skeleton h-48 w-full rounded-xl" />
          ) : topZones.length > 0 ? (
            <div className="space-y-2">
              {topZones.map((z, i) => (
                <div key={z.zoneId} className="mp-rank">
                  <span className={cn("mp-medal", i === 0 && "is-gold", i === 1 && "is-silver", i === 2 && "is-bronze")}>
                    {i === 0 ? <Trophy size={13} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{z.name}</p>
                      <p className="shrink-0 text-sm font-bold tabular-nums">{inr(z.revenue24h, true)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                      {z.city ?? "—"} · {formatNumber(z.demand24h)} demand · score {Math.round(z.earningScore)}
                    </p>
                    <div className="biz-meter mt-2">
                      <span style={{ width: `${Math.max(6, Math.min(100, z.earningScore))}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={MapPin}
              title="No zone rankings yet"
              reason="Earning scores appear after geofences take bookings. Draw coverage in Zone Control to start the board."
              href="/geofences"
              cta="Open Zone Control"
            />
          )}
          {zoneSeries.some((z) => z.value > 0) ? (
            <div className="mt-5">
              <IsoBarChart data={zoneSeries} format={(v) => inr(v, true)} accent="amber" layout="column" height={160} />
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="biz-glass-panel p-6">
            <SectionHead icon={MapPin} tone="cyan" title="Supply & availability" subtitle="Live ops coverage" />
            {opsMap.isLoading ? (
              <div className="biz-skeleton h-28 w-full rounded-xl" />
            ) : metrics ? (
              <div className="space-y-1">
                <Mini label="Online coverage" value={`${coverage}%`} />
                <div
                  className={cn("biz-meter", coverage >= 50 ? "biz-meter--success" : coverage > 0 ? "biz-meter--warning" : "biz-meter--danger")}
                >
                  <span style={{ width: `${Math.max(6, coverage)}%` }} />
                </div>
                <Mini label="Service gaps" value={`${metrics.serviceGaps} zones`} />
                <div className={cn("biz-meter", metrics.serviceGaps > 0 ? "biz-meter--danger" : "biz-meter--success")}>
                  <span style={{ width: `${Math.max(6, Math.min(100, metrics.serviceGaps * 10))}%` }} />
                </div>
                <Mini label="Active bookings" value={formatNumber(metrics.activeBookings)} />
                <Mini label="Avg ETA" value={`${Math.round(metrics.averageEtaMin)} min`} />
                <Mini label="Alerts" value={formatNumber(metrics.alerts)} />
                <Link href="/operations" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                  Live Ops <ExternalLink size={11} />
                </Link>
              </div>
            ) : (
              <EmptyLane icon={MapPin} title="Ops map quiet" reason="Coverage meters fill when partners come online." href="/operations" cta="Live Ops" />
            )}
          </div>

          {riskZones.length > 0 ? (
            <div className="biz-glass-panel p-6">
              <SectionHead icon={AlertTriangle} tone="danger" title="High-risk zones" subtitle="Composite risk on the scoring board" />
              <div className="space-y-2">
                {riskZones.map((z) => (
                  <Mini key={z.zoneId} label={z.name} value={`${Math.round(z.riskScore)}`} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={FileText}
            tone={pendingDocs.length > 0 ? "warning" : "success"}
            title="Document Review"
            subtitle="Partner KYC waiting on HQ"
            action={
              <Link href="/vendors/documents" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Queue
              </Link>
            }
          />
          {docsQ.isLoading ? (
            <div className="biz-skeleton h-36 w-full rounded-xl" />
          ) : pendingDocs.length > 0 ? (
            <div className="space-y-1.5">
              {pendingDocs.slice(0, 5).map((d) => {
                const name =
                  d.provider.businessName ||
                  [d.provider.user.firstName, d.provider.user.lastName].filter(Boolean).join(" ") ||
                  "Partner";
                return (
                  <PersonRow
                    key={d.id}
                    name={name}
                    email={d.documentType.replace(/_/g, " ")}
                    meta={d.uploadedAt ? formatDate(d.uploadedAt) : undefined}
                    value="Review"
                    tone="muted"
                  />
                );
              })}
            </div>
          ) : (
            <EmptyLane
              icon={FileText}
              tone="success"
              title="Queue is clear"
              reason="No partner documents are waiting. New uploads will land here instantly."
              href="/vendors/documents"
              cta="Document Review"
            />
          )}
        </div>

        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={Star}
            tone="warning"
            title="Latest reviews"
            subtitle="Trust feed from completed jobs"
            action={
              <Link href="/reviews" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Moderate
              </Link>
            }
          />
          {reviewsQ.isLoading ? (
            <div className="biz-skeleton h-36 w-full rounded-xl" />
          ) : reviews.length > 0 ? (
            <div className="space-y-2.5">
              {reviews.slice(0, 5).map((r) => (
                <div key={r.id} className="mp-review">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{r.customer}</p>
                    <span className={cn("mp-stars", r.isFlagged && "is-flagged")}>{stars(r.rating)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                    {r.service} · {r.provider}
                  </p>
                  {r.reviewText ? (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-biz-text)]">{r.reviewText}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={Star}
              tone="warning"
              title="No reviews yet"
              reason="Ratings appear after the first completed booking is reviewed."
              href="/reviews"
              cta="Open reviews"
            />
          )}
        </div>

        <div className="biz-glass-panel p-6">
          <SectionHead
            icon={LayoutGrid}
            title="Catalog & benefits"
            subtitle="Live services and membership usage"
            action={
              <Link href="/services" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Services
              </Link>
            }
          />
          {catalogQ.isLoading && insights.isLoading ? (
            <div className="biz-skeleton h-36 w-full rounded-xl" />
          ) : services.length > 0 || topBenefits.length > 0 ? (
            <div className="space-y-3">
              {services.slice(0, 5).map((s) => (
                <div key={s.id}>
                  <Mini label={s.name} value={s.isActive ? inr(s.basePrice, true) : "off"} />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {s.isFeatured ? <span className="dt-chip is-on">Featured</span> : null}
                    {s.isPopular ? <span className="dt-chip">Popular</span> : null}
                    <span className="dt-chip">{s.category}</span>
                  </div>
                </div>
              ))}
              {topBenefits.length > 0 ? (
                <div className="border-t border-[var(--color-biz-line)] pt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
                    Benefit usage
                  </p>
                  {topBenefits.slice(0, 4).map((b) => (
                    <Mini
                      key={str(b.benefitType)}
                      label={str(b.benefitType).replace(/_/g, " ")}
                      value={`${formatNumber(num(b.usageCount))} · ${inr(num(b.totalAmount), true)}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyLane
              icon={LayoutGrid}
              title="Catalog is empty"
              reason="Publish the first service to give partners something to fulfil."
              href="/services"
              cta="Add a service"
            />
          )}
        </div>
      </section>
    </div>
  );
}
