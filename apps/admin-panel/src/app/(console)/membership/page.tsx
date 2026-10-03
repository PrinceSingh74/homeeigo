"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Clock,
  Coins,
  Crown,
  FilterX,
  Gift,
  IndianRupee,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import {
  useAdminPlansQuery,
  useAdminRevenueQuery,
  useCreatePlanMutation,
  useUpdatePlanMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminApi, type AdminPlanRow, type AdminPlanInput } from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { AdminApiError, getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const INTERVALS = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
const TIERS = ["premium", "gold", "platinum", "silver"] as const;
const INTERVAL_LABEL: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

type StatusFilter = "all" | "active" | "inactive";
type IntervalFilter = "all" | (typeof INTERVALS)[number];
type SortKey = "order" | "subscribers" | "price" | "name";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/membership/cashback", label: "Cashback" },
  { href: "/membership/queue", label: "Priority Queue" },
  { href: "/membership/coupons", label: "Coupons" },
  { href: "/membership/analytics", label: "Analytics" },
  { href: "/customers", label: "Customers" },
] as const;

type FormState = {
  name: string;
  interval: (typeof INTERVALS)[number];
  price: string;
  tier: string;
  description: string;
  benefits: string;
  isActive: boolean;
};

function toForm(p?: AdminPlanRow): FormState {
  return {
    name: p?.name ?? "",
    interval: p?.interval ?? "MONTHLY",
    price: p ? String(p.price) : "",
    tier: (p?.tier ?? "premium").toLowerCase(),
    description: p?.description ?? "",
    benefits: (p?.benefits ?? []).map((b) => b.label).join("\n"),
    isActive: p?.isActive ?? true,
  };
}

function toInput(form: FormState): AdminPlanInput {
  return {
    name: form.name.trim(),
    interval: form.interval,
    price: Number(form.price),
    tier: form.tier.trim() || "premium",
    description: form.description.trim() || undefined,
    benefits: form.benefits
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean),
  };
}

function formValid(form: FormState) {
  return form.name.trim().length >= 2 && Number(form.price) > 0;
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

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function skipForbidden(failureCount: number, error: unknown) {
  if (error instanceof AdminApiError && (error.status === 403 || error.status === 401)) return false;
  return failureCount < 1;
}

function liveCount(p: AdminPlanRow) {
  return p.activeSubscribers ?? p._count?.subscriptions ?? 0;
}

function clubBrief(input: {
  total: number;
  active: number;
  inactive: number;
  liveMembers: number;
  expiringSoon: number;
  churnedThisMonth: number;
  churnRatePct: number;
}) {
  const { total, active, inactive, liveMembers, expiringSoon, churnedThisMonth, churnRatePct } = input;
  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The club desk is live, but no plan has been published yet. Empty is a new membership catalog — not a broken page.",
      impact: "Customers cannot subscribe until HQ creates the first active plan.",
      action: "Compose the first plan from this dock. Activate it when the price and benefits are right.",
    };
  }
  if (active === 0 || (liveMembers === 0 && total > 0) || churnRatePct >= 15) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        active === 0
          ? `${total} plan${total === 1 ? "" : "s"} sit on the desk, but none are visible to customers.`
          : liveMembers === 0
            ? "Plans exist, but nobody is currently subscribed. Recurring revenue is at zero."
            : `Churn is ${churnRatePct}% this month — the club is losing members faster than it should.`,
      impact: `${formatNumber(liveMembers)} live · ${formatNumber(active)} plans on · ${formatNumber(churnedThisMonth)} left this month.`,
      action: "Open Inactive if a plan should sell. Watch the renewal desk for members expiring this week.",
    };
  }
  if (inactive > 0 || expiringSoon > 0 || churnedThisMonth > 0) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        expiringSoon > 0
          ? `${formatNumber(expiringSoon)} membership${expiringSoon === 1 ? "" : "s"} expire within 7 days.`
          : inactive > 0
            ? `${inactive} inactive plan${inactive === 1 ? "" : "s"} still sit beside the live shelf.`
            : `${formatNumber(churnedThisMonth)} member${churnedThisMonth === 1 ? "" : "s"} cancelled or expired this month.`,
      impact: `${formatNumber(liveMembers)} live members · ${formatNumber(active)} of ${formatNumber(total)} plans on.`,
      action: expiringSoon > 0 ? "Open the renewal desk and reach members before the term ends." : "Keep only the plans that should sell. Pause the rest with intent.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Live plans, members, and retention are in range.",
    impact: `${formatNumber(liveMembers)} live · ${formatNumber(active)} plans on · ${churnRatePct}% churn.`,
    action: "Keep benefits honest. No club-desk action required.",
  };
}

function EmptyLane({
  icon: Icon,
  tone = "warning",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof Crown;
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
      <span className="cu-avatar mb-avatar" aria-hidden>
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
  { icon: Crown, tone: "warning" as const, title: "Plan", copy: "Name, tier, interval" },
  { icon: Wallet, tone: "success" as const, title: "Price", copy: "INR, benefits, live members" },
  { icon: Users, tone: "cyan" as const, title: "Roster", copy: "Who is on this plan now" },
  { icon: Power, tone: "success" as const, title: "Shelf", copy: "Activate or take it off" },
];

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cu-filter">
      <span className="cu-filter__label">{label}</span>
      <div className="cu-filter__row">{children}</div>
    </div>
  );
}

function InspectIdle({ matching, onCompose }: { matching: number; onCompose: () => void }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={Crown} tone="warning" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Club file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a plan — or use ↑ ↓ — to inspect price, benefits, and who is subscribed.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Club file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg mb-avatar cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected plan</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The club is empty — compose the first plan from this dock"}
            </p>
          </div>
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
        <button type="button" className="biz-btn w-full justify-center" onClick={onCompose}>
          <Plus size={14} />
          New plan
        </button>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}

export default function MembershipPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [intervalFilter, setIntervalFilter] = useState<IntervalFilter>("all");
  const [sort, setSort] = useState<SortKey>("order");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<AdminPlanRow | null>(null);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      interval: intervalFilter === "all" ? undefined : intervalFilter,
      sort: sort === "order" ? undefined : sort,
    }),
    [debouncedSearch, intervalFilter, sort, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminPlansQuery(params);
  const { data: revenue, isLoading: revenueLoading } = useAdminRevenueQuery();
  const createMut = useCreatePlanMutation();
  const updateMut = useUpdatePlanMutation();

  const analyticsQ = useQuery({
    queryKey: ["admin", "membership", "analytics"],
    queryFn: () => adminApi.subscriptions.analytics(),
    retry: skipForbidden,
  });
  const insightsQ = useQuery({
    queryKey: ["admin", "membership", "insights"],
    queryFn: () => adminApi.subscriptions.insights(),
    retry: skipForbidden,
  });
  const cashbackQ = useQuery({
    queryKey: ["admin", "membership", "cashback"],
    queryFn: () => adminApi.subscriptions.cashbackDashboard(),
    retry: skipForbidden,
  });
  const queueQ = useQuery({
    queryKey: ["admin", "membership", "queue"],
    queryFn: () => adminApi.subscriptions.queueAnalytics(),
    retry: skipForbidden,
  });
  const couponsQ = useQuery({
    queryKey: ["admin", "membership", "coupons"],
    queryFn: () => adminApi.membershipCoupons.list({ page: 1, limit: 1 }),
    retry: skipForbidden,
  });
  const matchingQ = useQuery({
    queryKey: ["admin", "membership", "matching"],
    queryFn: () => adminApi.subscriptions.matchingAnalytics(),
    retry: skipForbidden,
  });
  const planMembersQ = useQuery({
    queryKey: ["admin", "sub", "subscribers", { planId: selectedId, status: "active", limit: 6 }],
    queryFn: () =>
      adminApi.subscriptions.subscribers({ planId: selectedId!, status: "active", limit: 6, page: 1 }),
    enabled: Boolean(selectedId) && !composing && !editing,
    retry: skipForbidden,
  });

  const plans = useMemo(() => data?.plans ?? [], [data?.plans]);
  const summary = data?.summary;
  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const filtersOn =
    Boolean(debouncedSearch) || statusFilter !== "all" || intervalFilter !== "all" || sort !== "order";

  const a = (analyticsQ.data ?? {}) as Record<string, unknown>;
  const insights = (insightsQ.data ?? {}) as Record<string, unknown>;
  const cashback = (cashbackQ.data ?? {}) as Record<string, unknown>;
  const queuePayload = queueQ.data;
  const matching = matchingQ.data;

  const mrr = num(a.mrr) || summary?.liveMrr || 0;
  const arr = num(a.arr) || mrr * 12;
  const churnRatePct = num(a.churnRatePct);
  const retentionRatePct = num(a.retentionRatePct) || (churnRatePct ? Math.round((100 - churnRatePct) * 10) / 10 : 0);
  const liveMembers = summary?.liveMembers ?? revenue?.activeSubscribers ?? num(a.activeSubscribers);
  const expiringSoon = summary?.expiringSoon ?? 0;
  const churnedThisMonth = summary?.churnedThisMonth ?? num(a.churnedThisMonth);

  const planDist = Array.isArray(a.planDistribution)
    ? (a.planDistribution as Array<{ planName?: string; count?: number; sharePct?: number }>)
    : [];
  const trendsWrap = a.trends as { points?: Array<{ label?: string; mrr?: number }> } | undefined;
  const trendPoints = Array.isArray(trendsWrap?.points) ? trendsWrap.points : [];
  const churnRisk = Array.isArray(insights.churnRiskUsers)
    ? (insights.churnRiskUsers as Array<{ name?: string; email?: string; plan?: string; expiresAt?: string }>)
    : [];
  const upgradeRecs = Array.isArray(insights.upgradeRecommendations)
    ? (insights.upgradeRecommendations as Array<{ name?: string; email?: string; totalSpent?: number }>)
    : [];

  useEffect(() => {
    if (selectedId && !plans.some((p) => p.id === selectedId) && !isFetching) {
      setSelectedId(null);
      setEditing(false);
    }
  }, [isFetching, plans, selectedId]);

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
        setComposing(false);
        setEditing(false);
        return;
      }
      if (typing || composing || editing || plans.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? plans.findIndex((p) => p.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(plans.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(plans[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing, editing, plans, selectedId]);

  const total = summary?.total ?? plans.length;
  const active = summary?.active ?? 0;
  const inactive = summary?.inactive ?? Math.max(0, total - active);
  const liveShare = total > 0 ? Math.round((active / total) * 100) : 0;

  const brief = clubBrief({
    total,
    active,
    inactive,
    liveMembers,
    expiringSoon,
    churnedThisMonth,
    churnRatePct,
  });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const fetching =
    isFetching || analyticsQ.isFetching || insightsQ.isFetching || cashbackQ.isFetching || queueQ.isFetching;
  const saving = createMut.isPending || updateMut.isPending;

  const startCompose = () => {
    setSelectedId(null);
    setEditing(false);
    setComposing(true);
    setForm(toForm());
    setFormError(null);
  };

  const startEdit = (p: AdminPlanRow) => {
    setComposing(false);
    setSelectedId(p.id);
    setEditing(true);
    setForm(toForm(p));
    setFormError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setIntervalFilter("all");
    setSort("order");
  };

  const submitForm = async () => {
    if (!formValid(form)) return;
    setFormError(null);
    try {
      const body = toInput(form);
      if (editing && selected) {
        await updateMut.mutateAsync({
          id: selected.id,
          body: {
            name: body.name,
            price: body.price,
            description: body.description,
            benefits: body.benefits,
            tier: body.tier,
            isActive: form.isActive,
          },
        });
        setEditing(false);
      } else {
        const created = await createMut.mutateAsync(body);
        if (created?.id && !form.isActive) {
          await updateMut.mutateAsync({ id: created.id, body: { isActive: false } });
        }
        setComposing(false);
        if (created?.id) setSelectedId(created.id);
      }
    } catch (e) {
      setFormError(getErrorMessage(e));
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const showForm = composing || (editing && selected);
  const mixSource =
    planDist.length > 0
      ? planDist.map((p) => ({ label: p.planName ?? "Plan", value: num(p.count) }))
      : plans.map((p) => ({ label: p.name, value: liveCount(p) })).filter((p) => p.value > 0);

  return (
    <div className="exec-hq cu-page mb-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="mb-hero-sheen" aria-hidden />
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Crown} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Membership</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Club desk
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Plans, live members, and subscription revenue — inspect one club file at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="mb-chip-card" aria-hidden={false}>
              <span>MRR</span>
              <strong>{analyticsQ.isLoading && !mrr ? "—" : inr(mrr, true)}</strong>
            </div>
            <button type="button" onClick={startCompose} className="biz-btn">
              <Plus size={14} />
              New plan
            </button>
            <button type="button" onClick={() => void refetch()} className="biz-btn">
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
          label="MRR"
          value={inr(mrr, true)}
          sub={arr ? `${inr(arr, true)} ARR` : "from live members"}
          icon={IndianRupee}
          loading={isLoading || analyticsQ.isLoading}
          tone={mrr > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Live members"
          value={formatNumber(liveMembers)}
          sub={expiringSoon ? `${formatNumber(expiringSoon)} expire in 7d` : "active unexpired"}
          icon={Crown}
          loading={isLoading}
          tone={liveMembers > 0 ? "success" : "danger"}
        />
        <StatTile
          label="Retention"
          value={`${retentionRatePct}%`}
          sub={churnRatePct ? `${churnRatePct}% churn this month` : "no churn this month"}
          icon={Users}
          loading={analyticsQ.isLoading}
          tone={churnRatePct >= 10 ? "danger" : "success"}
        />
        <StatTile
          label="This month"
          value={inr(revenue?.monthRevenue ?? num(a.revenueThisMonth), true)}
          sub={`${formatNumber(revenue?.invoiceCount ?? num(a.invoicesThisMonth))} paid invoices`}
          icon={Wallet}
          loading={revenueLoading}
          tone={(revenue?.monthRevenue ?? 0) > 0 ? "accent" : "default"}
        />
      </section>

      {(inactive > 0 || expiringSoon > 0 || churnedThisMonth > 0) && total > 0 && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {inactive > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "inactive" && "is-on")}
              onClick={() => setStatusFilter("inactive")}
            >
              <Power size={14} />
              {inactive} inactive
            </button>
          ) : null}
          {expiringSoon > 0 ? (
            <span className="cu-rail__chip is-hot">
              <Clock size={14} />
              {expiringSoon} expire in 7d
            </span>
          ) : null}
          {churnedThisMonth > 0 ? (
            <span className="cu-rail__chip is-warm">
              <Users size={14} />
              {churnedThisMonth} left this month
            </span>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected || composing ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Club shelf</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {isLoading ? "Loading…" : `${formatNumber(plans.length)} matching`}
                  {active ? ` · ${formatNumber(active)} live` : ""}
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
                placeholder="Search plan, tier, description…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Lane">
                {(
                  [
                    ["all", "All"],
                    ["active", "Live"],
                    ["inactive", "Off"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={cn("cu-chip", statusFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Interval">
                {(
                  [
                    ["all", "All"],
                    ["MONTHLY", "Monthly"],
                    ["QUARTERLY", "Quarterly"],
                    ["YEARLY", "Yearly"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setIntervalFilter(key)}
                    className={cn("cu-chip", intervalFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                {(
                  [
                    ["order", "Shelf"],
                    ["subscribers", "Members"],
                    ["price", "Price"],
                    ["name", "Name"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setSort(key)}
                    className={cn("cu-chip", sort === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
            </div>
          </div>

          {actionError ? <div className="cu-alert">{actionError}</div> : null}

          <div className="cu-ledger__body">
            {isFetching && !isLoading ? <div className="cu-updating">Updating…</div> : null}

            {isLoading ? (
              <div className="cu-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="biz-skeleton h-[4.75rem] rounded-2xl" />
                ))}
              </div>
            ) : isError ? (
              <div className="cu-empty-wrap">
                <p className="text-sm">Could not load membership plans.</p>
                <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : plans.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Crown}
                  title={filtersOn ? "No match" : "Club is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search, lane, or interval."
                      : "Compose the first plan. It stays off the customer app until you activate it."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {plans.map((p) => {
                  const on = selectedId === p.id && !composing;
                  const members = liveCount(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false);
                          setEditing(false);
                          setSelectedId(on ? null : p.id);
                        }}
                        className={cn("cu-row mb-row", on && "is-on", p.isActive && "is-live", !p.isActive && "is-off")}
                      >
                        <span className={cn("cu-avatar mb-avatar", p.isActive && "is-live")} aria-hidden>
                          {initials(p.name)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 max-w-full truncate text-[0.95rem] font-semibold tracking-tight">
                              {p.name}
                            </p>
                            <StatusBadge status={p.isActive ? "active" : "inactive"} />
                          </div>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="capitalize">{p.tier}</span>
                            <span>{INTERVAL_LABEL[p.interval] ?? p.interval}</span>
                            <span>
                              {p.benefits.length} benefit{p.benefits.length === 1 ? "" : "s"}
                            </span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{inr(p.price, true)}</p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{formatNumber(members)} live</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <aside className={cn("cu-dock cu-panel", selected || composing ? "is-open" : "is-idle")}>
          {showForm ? (
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <Icon3D icon={editing ? Crown : Plus} tone="warning" size="md" />
                  <div className="min-w-0">
                    <p className="cu-intel__label">{editing ? "Edit plan" : "Compose"}</p>
                    <h2 className="mt-1.5 truncate text-lg font-bold tracking-tight">
                      {editing ? selected?.name ?? "Edit plan" : "New plan"}
                    </h2>
                    <p className="mt-1.5 text-sm text-[var(--color-biz-muted)]">
                      {editing
                        ? "Price, benefits, and shelf status write back to the live club."
                        : "Visible to customers only while Active is on."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="biz-btn !px-2.5"
                  onClick={() => {
                    setComposing(false);
                    setEditing(false);
                  }}
                  aria-label="Close form"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="cu-dock__body" tabIndex={0} role="region" aria-label={editing ? "Edit plan form" : "New plan form"}>
                <label className="mb-field">
                  <span>Name</span>
                  <input className="mb-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="HOMIGO Premium Monthly" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="mb-field">
                    <span>Interval</span>
                    <select
                      className="mb-input"
                      value={form.interval}
                      disabled={!!editing}
                      onChange={(e) => set("interval", e.target.value as FormState["interval"])}
                    >
                      {INTERVALS.map((i) => (
                        <option key={i} value={i}>
                          {INTERVAL_LABEL[i]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-field">
                    <span>Price (₹)</span>
                    <input
                      className="mb-input"
                      type="number"
                      min={1}
                      value={form.price}
                      onChange={(e) => set("price", e.target.value.replace(/[^\d]/g, ""))}
                    />
                  </label>
                  <label className="mb-field">
                    <span>Tier</span>
                    <select className="mb-input" value={form.tier} onChange={(e) => set("tier", e.target.value)}>
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mb-field">
                  <span>Description</span>
                  <input className="mb-input" value={form.description} onChange={(e) => set("description", e.target.value)} />
                </label>
                <label className="mb-field">
                  <span>Benefits (one per line)</span>
                  <textarea
                    className="mb-input mb-textarea"
                    rows={4}
                    value={form.benefits}
                    onChange={(e) => set("benefits", e.target.value)}
                    placeholder={"Priority booking\n5% cashback"}
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                  Active (visible to customers)
                </label>
                {formError ? <p className="text-sm text-[var(--color-biz-danger)]">{formError}</p> : null}
              </div>
              <div className="cu-dock__actions">
                <button
                  type="button"
                  className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
                  disabled={!formValid(form) || saving}
                  onClick={() => void submitForm()}
                >
                  {saving ? "Saving…" : editing ? "Save changes" : "Create plan"}
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <span className={cn("cu-avatar cu-avatar--lg mb-avatar", selected.isActive && "is-live")}>
                    {initials(selected.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">Club file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold tracking-tight">{selected.name}</h2>
                      <StatusBadge status={selected.isActive ? "active" : "inactive"} />
                    </div>
                    <p className="mt-1.5 text-sm capitalize text-[var(--color-biz-muted)]">
                      {selected.tier} · {INTERVAL_LABEL[selected.interval] ?? selected.interval}
                    </p>
                  </div>
                </div>
                <button type="button" className="biz-btn !px-2.5" onClick={() => setSelectedId(null)} aria-label="Close inspect">
                  <X size={14} />
                </button>
              </div>
              <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Membership plan details">
                <dl className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Price</dt>
                    <dd data-stat-value>{inr(selected.price, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Live</dt>
                    <dd data-stat-value>{formatNumber(liveCount(selected))}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Benefits</dt>
                    <dd data-stat-value>{formatNumber(selected.benefits.length)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>All-time</dt>
                    <dd data-stat-value>{formatNumber(selected.totalSubscribers ?? selected._count?.subscriptions ?? 0)}</dd>
                  </div>
                </dl>
                {selected.description ? (
                  <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">
                    {selected.description.slice(0, 360)}
                    {selected.description.length > 360 ? "…" : ""}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-biz-muted)]">No description on this plan yet.</p>
                )}
                {selected.benefits.length > 0 ? (
                  <ul className="mb-benefits">
                    {selected.benefits.map((b) => (
                      <li key={b.id}>{b.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--color-biz-muted)]">No benefits listed. Add them when you edit.</p>
                )}
                {planMembersQ.isLoading ? (
                  <div className="biz-skeleton h-24 rounded-2xl" />
                ) : (planMembersQ.data?.subscribers ?? []).length > 0 ? (
                  <div className="space-y-2">
                    <p className="cu-intel__label">On this plan</p>
                    {planMembersQ.data!.subscribers.slice(0, 5).map((s) => {
                      const name = `${s.user.firstName ?? ""} ${s.user.lastName ?? ""}`.trim() || s.user.email;
                      return (
                        <PersonMini
                          key={s.id}
                          name={name}
                          meta={s.expiresAt ? `Expires ${formatDate(s.expiresAt)}` : s.status}
                          value={s.autoRenew ? "Renew" : "Hold"}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-biz-muted)]">No live members on this plan right now.</p>
                )}
                <div className="cu-jump-row">
                  <Link href="/customers" className="biz-btn text-xs">
                    <Users size={13} />
                    Customers
                  </Link>
                  <Link href="/membership/analytics" className="biz-btn text-xs">
                    Analytics
                  </Link>
                </div>
              </div>
              <div className="cu-dock__actions">
                <button type="button" className="biz-btn w-full justify-center" onClick={() => startEdit(selected)}>
                  Edit plan
                </button>
                <button
                  type="button"
                  className={cn(
                    "biz-btn w-full justify-center",
                    selected.isActive ? "text-[var(--color-biz-warning)]" : "text-[var(--color-biz-success)]",
                  )}
                  disabled={updateMut.isPending}
                  onClick={() => {
                    setActionError(null);
                    if (selected.isActive) setConfirmOff(selected);
                    else {
                      void updateMut
                        .mutateAsync({ id: selected.id, body: { isActive: true } })
                        .catch((e) => setActionError(getErrorMessage(e)));
                    }
                  }}
                >
                  <Power size={14} />
                  {selected.isActive ? "Take off shelf" : "Activate"}
                </button>
              </div>
            </div>
          ) : (
            <InspectIdle matching={plans.length} onCompose={startCompose} />
          )}
        </aside>
      </section>

      <section className="cu-floor mb-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Crown}
            tone={retentionRatePct >= 80 ? "success" : "warning"}
            title="Club health"
            subtitle="Retention of live members this month"
          />
          <div className="mb-pulse">
            <GlassRing3D
              value={retentionRatePct}
              label="Keep"
              sub={`${churnRatePct}% churn`}
              tone={retentionRatePct >= 80 ? "success" : retentionRatePct > 0 ? "warning" : "danger"}
            />
            <div className="mb-meters">
              <MeterBar label="Plans live" value={liveShare} tone={liveShare >= 50 ? "success" : "accent"} />
              <MeterBar
                label="Expiring 7d"
                value={liveMembers > 0 ? Math.round((expiringSoon / liveMembers) * 1000) / 10 : 0}
                tone={expiringSoon > 0 ? "danger" : "success"}
              />
              <MeterBar label="Churn" value={churnRatePct} tone={churnRatePct >= 10 ? "danger" : "success"} />
            </div>
          </div>
          {trendPoints.length > 1 ? (
            <div className="mt-4 min-w-0">
              <IsoBarChart
                data={trendPoints.map((p) => ({ label: String(p.label ?? ""), value: num(p.mrr) }))}
                format={(v) => inr(v, true)}
                accent="amber"
                layout="area"
                height={140}
                isLoading={analyticsQ.isLoading}
              />
            </div>
          ) : analyticsQ.isError ? (
            <p className="mt-3 text-xs text-[var(--color-biz-muted)]">MRR trend needs analytics access.</p>
          ) : null}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Sparkles} tone="warning" title="Plan mix" subtitle="Live members by plan" />
          {mixSource.length > 0 ? (
            <IsoBarChart data={mixSource.slice(0, 8)} format={formatNumber} accent="amber" layout="bar" height={220} />
          ) : (
            <EmptyLane icon={Sparkles} title="No mix yet" reason="Plan share appears once the first membership is live." />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Clock}
            tone="warning"
            title="Renewal desk"
            subtitle="Active memberships ending within 7 days"
            action={
              <Link href="/customers" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Customers
              </Link>
            }
          />
          {insightsQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : insightsQ.isError ? (
            <EmptyLane
              icon={Clock}
              tone="warning"
              title="Renewals not in this role"
              reason="Expiry names need membership insights access. The 7-day count above still runs from the club shelf."
            />
          ) : churnRisk.length > 0 ? (
            <div className="space-y-2">
              {churnRisk.slice(0, 5).map((u, i) => (
                <PersonMini
                  key={`${u.email ?? i}`}
                  name={(u.name ?? "").trim() || u.email || "Member"}
                  meta={u.plan}
                  value={formatDate(u.expiresAt)}
                />
              ))}
            </div>
          ) : upgradeRecs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-biz-muted)]">Nobody expires this week. High spenders with no live membership:</p>
              {upgradeRecs.slice(0, 5).map((u, i) => (
                <PersonMini
                  key={`${u.email ?? i}`}
                  name={(u.name ?? "").trim() || u.email || "Customer"}
                  meta={u.email}
                  value={inr(num(u.totalSpent), true)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane
              icon={Clock}
              tone="success"
              title="Quiet week"
              reason="No memberships expire in the next 7 days, and no high-spend customers are waiting to join."
              href="/customers"
              cta="Customers"
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Coins} tone="success" title="Club ops" subtitle="Cashback, queue, coupons, premium match" />
          <div className="mb-ops">
            <Link href="/membership/cashback" className="mb-ops__row">
              <Icon3D icon={Coins} tone="success" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Cashback</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  {cashbackQ.isError
                    ? "Not in this role"
                    : cashbackQ.isLoading
                      ? "Loading…"
                      : `${inr(num(cashback.totalCredited), true)} credited · ${inr(num(cashback.pendingLiability), true)} pending`}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/membership/queue" className="mb-ops__row">
              <Icon3D icon={Clock} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Priority queue</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  {queueQ.isError
                    ? "Not in this role"
                    : queueQ.isLoading
                      ? "Loading…"
                      : `${formatNumber(num(queuePayload?.queue?.pendingHigh))} HIGH waiting`}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/membership/coupons" className="mb-ops__row">
              <Icon3D icon={Gift} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Coupons</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  {couponsQ.isError
                    ? "Not in this role"
                    : couponsQ.isLoading
                      ? "Loading…"
                      : `${formatNumber(couponsQ.data?.total ?? couponsQ.data?.coupons.length ?? 0)} on the desk`}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/bookings" className="mb-ops__row">
              <Icon3D icon={Crown} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Premium match</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                  {matchingQ.isError
                    ? "Not in this role"
                    : matchingQ.isLoading
                      ? "Loading…"
                      : `${matching?.premiumMatchRatePct ?? 0}% of bookings · ${formatNumber(matching?.premiumMatchedBookings ?? 0)} matched`}
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmOff}
        title={`Take "${confirmOff?.name ?? ""}" off the shelf?`}
        description="Customers will no longer see or buy this plan. Existing members keep their term until it expires."
        confirmLabel="Deactivate"
        destructive
        isLoading={updateMut.isPending}
        onClose={() => setConfirmOff(null)}
        onConfirm={async () => {
          if (!confirmOff) return;
          setActionError(null);
          try {
            await updateMut.mutateAsync({ id: confirmOff.id, body: { isActive: false } });
            setConfirmOff(null);
          } catch (e) {
            setActionError(getErrorMessage(e));
            setConfirmOff(null);
          }
        }}
      />
    </div>
  );
}
