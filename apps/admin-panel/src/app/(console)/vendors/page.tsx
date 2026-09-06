"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  BadgeX,
  CalendarCheck,
  Copy,
  FileText,
  FilterX,
  GraduationCap,
  IdCard,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { ActivationChecklistPanel } from "@/components/acquisition/ActivationChecklistPanel";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import {
  useAdminDashboardQuery,
  useAdminProvidersQuery,
  useVerifyProviderMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import { adminApi } from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import type { AdminProvider } from "@/types/admin";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "applications" | "pending" | "verified" | "rejected";
type KycFilter = "all" | "pending" | "verified";
type SortKey = "recent" | "earnings" | "rating" | "jobs";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/vendors/documents", label: "Document Review" },
  { href: "/academy", label: "Academy" },
  { href: "/workforce", label: "Workforce" },
  { href: "/operations", label: "Live Ops" },
] as const;

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

function relActivity(iso?: string | null) {
  if (!iso) return "no ping";
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d) || d < 0) return formatDate(iso);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return formatDate(iso);
}

function approvalLabel(p: AdminProvider) {
  if (p.registrationStatus === "REJECTED") return "rejected";
  if (p.isApproved) return "approved";
  if (p.registrationStatus === "PENDING") return "pending";
  return "pending";
}

function isApplication(p: AdminProvider) {
  return !p.isApproved && (p.registrationStatus ?? "PENDING") === "PENDING";
}

function partnerBrief(input: {
  total: number;
  online: number;
  applications: number;
  pendingDocs: number;
  rating: number;
  acceptance: number;
}) {
  const { total, online, applications, pendingDocs, rating, acceptance } = input;

  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The partner ledger is live, but nobody has applied yet. Empty is a new network — not a broken page.",
      impact: "KYC, academy, and live ops have nothing to rank until the first application lands.",
      action: "Keep Marketplace HQ publishing. The first self-registration will appear in Applications.",
    };
  }
  if (applications >= 5 || pendingDocs >= 5) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        applications >= 5
          ? `${applications} applications are waiting. Supply cannot expand until HQ approves the queue.`
          : `${pendingDocs} KYC packs sit in Document Review. Verified partners cannot go live until those clear.`,
      impact: `${formatNumber(online)} of ${formatNumber(total)} online · ${pendingDocs} documents open.`,
      action:
        applications >= 5
          ? "Open Applications, inspect the file, and approve or reject with notes today."
          : "Clear Document Review before pushing demand onto a thin roster.",
    };
  }
  if (applications > 0 || pendingDocs > 0 || (rating > 0 && rating < 4) || (acceptance > 0 && acceptance < 40)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        applications > 0
          ? `${applications} application${applications === 1 ? "" : "s"} still sit in the queue.`
          : pendingDocs > 0
            ? `${pendingDocs} KYC pack${pendingDocs === 1 ? "" : "s"} waiting on review.`
            : acceptance > 0 && acceptance < 40
              ? `Average acceptance is ${acceptance.toFixed(0)}%. Dispatch is leaking jobs.`
              : `Average rating is ${rating.toFixed(1)}★. Catalog trust is below the 4.0 bar.`,
      impact: `${formatNumber(total)} partners · ${formatNumber(online)} live · ${pendingDocs} KYC open.`,
      action:
        applications > 0
          ? "Inspect and decide on each application before the window goes stale."
          : pendingDocs > 0
            ? "Verify or reject pending partner documents today."
            : "Open Workforce and the partner file — do not scale demand on a weak roster.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Applications, KYC, and live supply are in range. The partner network is not the constraint.",
    impact: `${formatNumber(online)}/${formatNumber(total)} online · rating ${rating > 0 ? rating.toFixed(1) : "—"}★.`,
    action: "Keep Document Review clear and watch attendance. No partner-ledger action required.",
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
      <span className={cn("cu-avatar pn-avatar", live && "is-live")} aria-hidden>
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
  tone = "success",
  title,
  reason,
  href,
  cta,
}: {
  icon: typeof Wrench;
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
  { icon: IdCard, tone: "cyan" as const, title: "Identity", copy: "City, categories, last ping" },
  { icon: ShieldCheck, tone: "warning" as const, title: "Trust", copy: "Approval, KYC, documents" },
  { icon: Wallet, tone: "success" as const, title: "Earnings", copy: "Lifetime, wallet, jobs" },
  { icon: Radio, tone: "success" as const, title: "Live", copy: "Online, acceptance, completion" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={Wrench} tone="success" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Partner file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a roster name — or use ↑ ↓ — to open identity, KYC, and approval.
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
            <p className="cu-intel__label">Selected partner</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The roster is empty — new applications land on the left first"}
            </p>
          </div>
        </div>

        <div className="cu-dock__stats">
          {[
            ["Earnings", "—"],
            ["Jobs", "—"],
            ["Rating", "—"],
            ["Accept", "—"],
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

export default function VendorsPage() {
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

  const { data, isLoading, isFetching, isError, refetch } = useAdminProvidersQuery(params);
  const applicationsQ = useAdminProvidersQuery(
    { page: 1, limit: 1, status: "applications", badge: true },
    { enabled: secondary },
  );
  const verifyMutation = useVerifyProviderMutation();

  const docsQ = useQuery({
    queryKey: ["admin", "documents", "pending"],
    queryFn: () => adminApi.pendingDocuments(),
    staleTime: 30_000,
    enabled: secondary,
  });
  const workforceQ = useQuery({
    queryKey: ["admin", "workforce"],
    queryFn: () => adminApi.workforceAnalytics(),
    staleTime: 30_000,
    enabled: secondary,
  });
  const academyQ = useQuery({
    queryKey: ["admin", "academy"],
    queryFn: () => adminApi.academyModules(),
    staleTime: 120_000,
    enabled: secondary,
  });
  const detailQ = useQuery({
    queryKey: ["admin", "provider-detail", selectedId],
    queryFn: () => adminApi.getProviderDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 20_000,
  });
  const intelQ = useQuery({
    queryKey: ["admin", "provider-intel", selectedId],
    queryFn: () => adminApi.getProviderIntelligence(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });
  const checklistQ = useQuery({
    queryKey: ["admin", "activation-checklist", selectedId],
    queryFn: () => adminApi.partnerAcquisition.activationChecklist(selectedId!),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const [confirmTarget, setConfirmTarget] = useState<{
    provider: AdminProvider;
    action: "approve" | "reject";
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const partners = data?.providers ?? [];
  const selected = partners.find((p) => p.id === selectedId) ?? null;
  const activationReady = selected?.isApproved || checklistQ.data?.ready === true;
  const filtersOn = Boolean(debouncedSearch) || statusFilter !== "all" || kycFilter !== "all" || sort !== "recent";

  useEffect(() => {
    if (selectedId && !partners.some((p) => p.id === selectedId) && !isFetching) {
      setSelectedId(null);
    }
  }, [isFetching, partners, selectedId]);

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
      if (typing || partners.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? partners.findIndex((p) => p.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(partners.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(partners[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [partners, selectedId]);

  const totalPartners = dashboard.data?.stats.totalProviders ?? data?.total ?? 0;
  const onlineNow = dashboard.data?.stats.activeNow ?? workforceQ.data?.onlineProviders ?? 0;
  const applications = applicationsQ.data?.total ?? 0;
  const pendingDocs = docsQ.data?.documents ?? [];
  const workforce = workforceQ.data;
  const rating = workforce?.avgRating ?? dashboard.data?.stats.averageRating ?? 0;
  const acceptance = workforce?.avgAcceptanceRate ?? 0;
  const coverage = totalPartners > 0 ? Math.round((onlineNow / totalPartners) * 100) : 0;

  const brief = partnerBrief({
    total: totalPartners,
    online: onlineNow,
    applications,
    pendingDocs: pendingDocs.length,
    rating,
    acceptance,
  });

  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const attendanceSeries = useMemo(
    () => (workforce?.checkInsByDay ?? []).map((row) => ({ label: row.date.slice(5), value: row.count })),
    [workforce?.checkInsByDay],
  );

  const pageEarnings = partners.reduce((s, p) => s + (p.totalEarnings || 0), 0);
  const academyModules = (academyQ.data?.modules ?? []) as Array<{
    id: string;
    title: string;
    contentType?: string;
    isPublished?: boolean;
  }>;
  const publishedAcademy = academyModules.filter((m) => m.isPublished).length;

  const fetching =
    isFetching ||
    docsQ.isFetching ||
    workforceQ.isFetching ||
    academyQ.isFetching ||
    dashboard.isFetching ||
    applicationsQ.isFetching;

  const refresh = () => {
    void refetch();
    void applicationsQ.refetch();
    void docsQ.refetch();
    void workforceQ.refetch();
    void academyQ.refetch();
    if (selectedId) {
      void detailQ.refetch();
      void intelQ.refetch();
    }
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

  const openFromList = (name?: string, id?: string) => {
    if (name) setSearch(name);
    setStatusFilter("all");
    setKycFilter("all");
    setSort("recent");
    setPage(1);
    if (id) setSelectedId(id);
  };

  const detail = detailQ.data;
  const completionShare =
    selected && selected.totalBookings > 0
      ? Math.round(((selected.completedBookings || 0) / selected.totalBookings) * 100)
      : Math.round(selected?.completionRate ?? 0);

  return (
    <div className="exec-hq cu-page pn-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Wrench} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Partner Network</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Live roster
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Applications, KYC, live supply, and earnings for every homigo.com partner — inspect one file at a time.
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
          label="Partners"
          value={formatNumber(totalPartners)}
          sub={onlineNow ? `${formatNumber(onlineNow)} live now` : "registered roster"}
          icon={Users}
          loading={dashboard.isLoading}
        />
        <StatTile
          label="Live now"
          value={formatNumber(onlineNow)}
          sub={workforce ? `${formatNumber(workforce.idleOnline)} idle · ${formatNumber(workforce.busyProviders)} on job` : `${coverage}% of roster`}
          icon={Radio}
          loading={dashboard.isLoading}
          tone={onlineNow > 0 ? "success" : "default"}
        />
        <StatTile
          label="Applications"
          value={formatNumber(applications)}
          sub={applications > 0 ? "waiting on HQ approval" : "queue is clear"}
          icon={Sparkles}
          loading={applicationsQ.isLoading}
          tone={applications > 0 ? "accent" : "success"}
        />
        <StatTile
          label="KYC queue"
          value={formatNumber(pendingDocs.length)}
          sub={pendingDocs.length > 0 ? "packs in Document Review" : "no documents waiting"}
          icon={FileText}
          loading={docsQ.isLoading}
          tone={pendingDocs.length > 0 ? "danger" : "success"}
        />
      </section>

      {(applications > 0 || pendingDocs.length > 0 || (workforce?.offlineProviders ?? 0) > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {applications > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "applications" && "is-on")}
              onClick={() => {
                setStatusFilter("applications");
                setKycFilter("all");
                setPage(1);
              }}
            >
              <Sparkles size={14} />
              {applications} applications
            </button>
          ) : null}
          {pendingDocs.length > 0 ? (
            <Link href="/vendors/documents" className="cu-rail__chip is-hot">
              <FileText size={14} />
              {pendingDocs.length} KYC
              <ArrowUpRight size={11} />
            </Link>
          ) : null}
          {(workforce?.offlineProviders ?? 0) > 0 ? (
            <Link href="/workforce" className="cu-rail__chip">
              <Radio size={14} />
              {formatNumber(workforce?.offlineProviders ?? 0)} offline
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
                <h2 className="text-sm font-semibold tracking-tight">Roster</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {isLoading ? "Loading…" : `${formatNumber(data?.total ?? 0)} matching`}
                  {pageEarnings > 0 ? ` · ${inr(pageEarnings, true)} earned on this page` : ""}
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
                {(["all", "applications", "pending", "verified", "rejected"] as const).map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => {
                      setPage(1);
                      setStatusFilter(s);
                    }}
                    className={cn("cu-chip", statusFilter === s && "is-on")}
                  >
                    {s}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="KYC">
                {(["all", "pending", "verified"] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => {
                      setPage(1);
                      setKycFilter(k);
                    }}
                    className={cn("cu-chip", kycFilter === k && "is-on")}
                  >
                    {k}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                {(
                  [
                    ["recent", "Joined"],
                    ["earnings", "Earnings"],
                    ["rating", "Rating"],
                    ["jobs", "Jobs"],
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
                <p className="text-sm">Could not load the partner roster.</p>
                <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : partners.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Wrench}
                  title={filtersOn ? "No match" : "Roster is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search and filters."
                      : "The first self-registration will appear here with KYC, rating, and earnings."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {partners.map((p) => {
                  const on = selectedId === p.id;
                  const app = isApplication(p);
                  const live = Boolean(p.isOnline);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : p.id)}
                        className={cn("cu-row pn-row", on && "is-on", app && "is-app", live && !app && "is-live")}
                      >
                        <span className={cn("cu-avatar pn-avatar", live && "is-live", app && "is-app")} aria-hidden>
                          {initials(p.name)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[0.95rem] font-semibold tracking-tight">{p.name}</p>
                            {live ? (
                              <span className="pn-live">
                                <span className="pn-live__dot" aria-hidden />
                                Live
                              </span>
                            ) : null}
                            <StatusBadge status={approvalLabel(p)} />
                            <StatusBadge status={p.isVerified ? "verified" : "pending"} />
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{p.email ?? "—"}</span>
                            {p.city ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={11} />
                                {p.city}
                              </span>
                            ) : null}
                            {p.serviceCategories?.length ? (
                              <span>{p.serviceCategories.slice(0, 2).join(", ")}</span>
                            ) : null}
                            <span>{relActivity(p.lastSeenAt)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="pn-stars justify-end text-[0.95rem]">
                            <Star size={13} />
                            {(p.rating ?? 0).toFixed(2)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                            {inr(p.totalEarnings, true)}
                            {p.totalBookings ? ` · ${formatNumber(p.totalBookings)} jobs` : ""}
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
                  <span className={cn("cu-avatar cu-avatar--lg pn-avatar", selected.isOnline && "is-live", isApplication(selected) && "is-app")}>
                    {initials(selected.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">Partner file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold tracking-tight">{selected.name}</h2>
                      {selected.isOnline ? (
                        <span className="pn-live">
                          <span className="pn-live__dot" aria-hidden />
                          Live
                        </span>
                      ) : (
                        <StatusBadge status="offline" />
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">{selected.email ?? "—"}</p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Last ping {relActivity(selected.lastSeenAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={approvalLabel(selected)} />
                      <StatusBadge status={selected.isVerified ? "verified" : "pending"} />
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

              <div className="cu-dock__body">
                <div className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Earnings</dt>
                    <dd data-stat-value>{inr(selected.totalEarnings, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Jobs</dt>
                    <dd data-stat-value>{formatNumber(selected.totalBookings)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Rating</dt>
                    <dd data-stat-value>{(selected.rating ?? 0).toFixed(2)}★</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Accept</dt>
                    <dd data-stat-value>{Math.round(selected.acceptanceRate ?? 0)}%</dd>
                  </div>
                </div>

                {selected.serviceCategories?.length ? (
                  <div className="pn-cats">
                    {selected.serviceCategories.slice(0, 6).map((c) => (
                      <span key={c} className="pn-cat">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="cu-intel">
                  <p className="cu-intel__label">Partner OS</p>
                  {detailQ.isLoading ? (
                    <div className="biz-skeleton mt-4 h-28 rounded-xl" />
                  ) : (
                    <>
                      <dl className="cu-intel__rows">
                        <div>
                          <dt>Completed</dt>
                          <dd>{formatNumber(selected.completedBookings)}</dd>
                        </div>
                        <div>
                          <dt>Reviews</dt>
                          <dd>{formatNumber(selected.totalReviews ?? detail?.metrics.totalReviews ?? 0)}</dd>
                        </div>
                        <div>
                          <dt>Repeat customers</dt>
                          <dd>
                            {intelQ.data
                              ? `${intelQ.data.repeatCustomerRatePct.toFixed(0)}% · ${formatNumber(intelQ.data.uniqueCustomers)} unique`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Joined</dt>
                          <dd>{formatDate(selected.registeredAt ?? selected.createdAt)}</dd>
                        </div>
                      </dl>
                      {selected.totalBookings > 0 || (selected.completionRate ?? 0) > 0 ? (
                        <div className="mt-4 space-y-3">
                          <MeterBar
                            label="Completed share"
                            value={completionShare}
                            tone={completionShare >= 70 ? "success" : completionShare >= 40 ? "accent" : "danger"}
                          />
                          <MeterBar
                            label="Acceptance"
                            value={Math.round(selected.acceptanceRate ?? detail?.metrics.acceptanceRate ?? 0)}
                            tone={(selected.acceptanceRate ?? 0) >= 70 ? "success" : "accent"}
                          />
                        </div>
                      ) : null}
                      {selected.rejectionReason ? (
                        <p className="mt-3 text-xs leading-relaxed text-[var(--color-biz-danger)]">
                          Rejected: {selected.rejectionReason}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="cu-jump-row">
                  <Link href={`/vendors/${selected.id}`} className="biz-btn text-xs">
                    <IdCard size={13} />
                    Full file
                  </Link>
                  <Link href="/vendors/documents" className="biz-btn text-xs">
                    <FileText size={13} />
                    Documents
                  </Link>
                  <Link
                    href={`/bookings?q=${encodeURIComponent(selected.name)}`}
                    className="biz-btn text-xs"
                  >
                    <CalendarCheck size={13} />
                    Bookings
                  </Link>
                  {selected.email ? (
                    <button type="button" className="biz-btn text-xs" onClick={() => void copyText(selected.email!, "email")}>
                      <Copy size={13} />
                      {copied === "email" ? "Copied" : "Email"}
                    </button>
                  ) : null}
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyText(selected.id, "id")}>
                    <Copy size={13} />
                    {copied === "id" ? "Copied" : "ID"}
                  </button>
                </div>

                {!selected.isApproved ? (
                  <ActivationChecklistPanel
                    compact
                    providerId={selected.id}
                    providerName={selected.name}
                    isApproved={selected.isApproved}
                    checklist={checklistQ.data}
                    isLoading={checklistQ.isLoading}
                    onRefresh={() => void checklistQ.refetch()}
                  />
                ) : null}
              </div>

              <div className="cu-dock__actions">
                {!selected.isApproved ? (
                  <>
                    {checklistQ.data && !checklistQ.data.ready ? (
                      <p className="mb-2 text-[11px] leading-relaxed text-amber-400">
                        Activation blocked · {checklistQ.data.progressPercent}% ready ·{" "}
                        {checklistQ.data.missingLabels.slice(0, 3).join(", ")}
                        {checklistQ.data.missingLabels.length > 3 ? "…" : ""}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
                      disabled={verifyMutation.isPending || !activationReady}
                      onClick={() => setConfirmTarget({ provider: selected, action: "approve" })}
                    >
                      <BadgeCheck size={14} />
                      Activate partner
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="biz-btn w-full justify-center text-[var(--color-biz-danger)]"
                    disabled={verifyMutation.isPending}
                    onClick={() => setConfirmTarget({ provider: selected, action: "reject" })}
                  >
                    <BadgeX size={14} />
                    Revoke approval
                  </button>
                )}
              </div>
            </div>
          ) : (
            <InspectIdle matching={data?.total ?? partners.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor pn-floor">
        <div className="cu-panel pn-fleet-card">
          <SectionHead
            icon={Radio}
            tone={coverage >= 50 ? "success" : "warning"}
            title="Fleet"
            subtitle="Live coverage, acceptance, and 14-day check-ins"
          />
          <div className="pn-fleet">
            <GlassRing3D
              value={coverage}
              label="Live"
              sub={`${formatNumber(onlineNow)} of ${formatNumber(totalPartners)}`}
              tone={coverage >= 50 ? "success" : coverage > 0 ? "warning" : "danger"}
            />
            <div className="pn-meters">
              <MeterBar
                label="Acceptance"
                value={acceptance}
                tone={acceptance >= 70 ? "success" : acceptance >= 40 ? "accent" : "danger"}
              />
              <MeterBar
                label="Completion"
                value={workforce?.avgCompletionRate ?? 0}
                tone={(workforce?.avgCompletionRate ?? 0) >= 70 ? "success" : "accent"}
              />
              <MeterBar
                label="On-time"
                value={workforce?.avgOnTimeRate ?? 0}
                tone={(workforce?.avgOnTimeRate ?? 0) >= 70 ? "success" : "accent"}
              />
            </div>
          </div>
          <div className="pn-chart">
            <p className="cu-intel__label mb-3">Check-ins · 14d</p>
            <IsoBarChart
              data={attendanceSeries}
              format={formatNumber}
              accent="emerald"
              layout="area"
              height={156}
              isLoading={workforceQ.isLoading}
            />
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Trophy}
            tone="warning"
            title="Elite partners"
            subtitle="Highest completion on the approved roster"
            action={
              <Link href="/workforce" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Workforce
              </Link>
            }
          />
          {workforceQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : (workforce?.topPartners ?? []).length > 0 ? (
            <div className="space-y-2">
              {workforce!.topPartners.slice(0, 5).map((p) => (
                <PersonMini
                  key={p.id}
                  name={p.name}
                  email={p.city ?? undefined}
                  meta={`${p.rating.toFixed(1)}★`}
                  value={`${Math.round(p.completionRate)}%`}
                  live={p.online}
                  onOpen={() => openFromList(p.name, p.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Trophy} tone="warning" title="No elite board" reason="Approved partners with completed jobs will rank here." href="/workforce" cta="Workforce" />
          )}
        </div>

        <div className="cu-panel">
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
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : pendingDocs.length > 0 ? (
            <div className="space-y-2">
              {pendingDocs.slice(0, 5).map((d) => {
                const name =
                  d.provider.businessName ||
                  [d.provider.user.firstName, d.provider.user.lastName].filter(Boolean).join(" ") ||
                  "Partner";
                return (
                  <PersonMini
                    key={d.id}
                    name={name}
                    email={d.documentType.replace(/_/g, " ")}
                    meta={d.uploadedAt ? formatDate(d.uploadedAt) : undefined}
                    value="Review"
                    onOpen={() => openFromList(name, d.providerId)}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyLane
              icon={FileText}
              tone="success"
              title="Queue is clear"
              reason="No partner documents are waiting. New uploads land in Document Review."
              href="/vendors/documents"
              cta="Documents"
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={MapPin}
            tone="cyan"
            title="City roster"
            subtitle="Approved partners by city"
            action={
              <Link href="/academy" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                <span className="inline-flex items-center gap-1">
                  <GraduationCap size={11} />
                  {publishedAcademy} academy
                </span>
              </Link>
            }
          />
          {workforceQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : (workforce?.cities ?? []).length > 0 ? (
            <div>
              {workforce!.cities.slice(0, 6).map((c) => {
                const max = Math.max(1, ...(workforce?.cities ?? []).map((x) => x.count));
                return (
                  <div key={c.city} className="pn-city">
                    <span className="max-w-[6.5rem] shrink-0 truncate text-sm font-semibold">{c.city}</span>
                    <div className="pn-city__bar" aria-hidden>
                      <span style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs font-bold tabular-nums">{c.count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={MapPin} tone="cyan" title="No city split" reason="Cities fill once approved partners set a home city." />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.action === "approve" ? "Activate this partner?" : "Revoke approval?"}
        description={
          confirmTarget
            ? confirmTarget.action === "approve"
              ? activationReady
                ? `${confirmTarget.provider.name} has passed all activation checks and will be approved.`
                : `Activation blocked — open Full file to complete checklist: ${checklistQ.data?.missingLabels.join(", ") ?? "loading…"}`
              : `${confirmTarget.provider.name} will be rejected and cannot sign in as a partner.`
            : undefined
        }
        confirmLabel={confirmTarget?.action === "approve" ? "Activate partner" : "Revoke"}
        destructive={confirmTarget?.action === "reject"}
        reasonLabel="Notes (optional)"
        reasonRequired={false}
        reasonPlaceholder={
          confirmTarget?.action === "approve" ? "e.g. KYC verified, training complete" : "e.g. Failed compliance review"
        }
        isLoading={verifyMutation.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (notes) => {
          if (!confirmTarget || (confirmTarget.action === "approve" && !activationReady)) return;
          setMutationError(null);
          try {
            await verifyMutation.mutateAsync({
              providerId: confirmTarget.provider.id,
              action: confirmTarget.action,
              notes,
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
