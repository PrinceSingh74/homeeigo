"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Award,
  BookOpen,
  Copy,
  ExternalLink,
  FilterX,
  GraduationCap,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  Video,
  ClipboardList,
  FileText,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { useAdminDashboardQuery, useAdminProvidersQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import {
  adminApi,
  type AcademyModule,
  type AcademyModuleInput,
} from "@/services/admin-api";
import { formatDate, formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type StatusFilter = "all" | "published" | "draft";
type SortKey = "order" | "recent" | "completions";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/vendors", label: "Partners" },
  { href: "/vendors/documents", label: "Document Review" },
  { href: "/workforce", label: "Workforce" },
] as const;

const CONTENT_TYPES = [
  ["video", "Video"],
  ["sop", "SOP"],
  ["assessment", "Assessment"],
  ["article", "Article"],
] as const;

function typeLabel(raw: string) {
  const hit = CONTENT_TYPES.find(([k]) => k === raw.toLowerCase());
  return hit?.[1] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function typeIcon(raw: string) {
  const t = raw.toLowerCase();
  if (t === "video") return Video;
  if (t === "sop") return ClipboardList;
  if (t === "assessment") return Trophy;
  return BookOpen;
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

function slugFrom(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function academyBrief(input: {
  total: number;
  published: number;
  drafts: number;
  learners: number;
  partners: number;
}) {
  const { total, published, drafts, learners, partners } = input;
  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The academy catalog is live, but no training module has been written yet. Empty is a new campus — not a broken page.",
      impact: "Partners cannot complete SOPs, videos, or assessments until HQ publishes the first module.",
      action: "Compose the first module from this dock. Publish when the SOP is ready for the partner app.",
    };
  }
  if (published === 0 || drafts >= 5) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        published === 0
          ? `${total} module${total === 1 ? "" : "s"} sit in draft. The partner app has nothing to train on.`
          : `${drafts} drafts are waiting. Supply of trained partners cannot expand until HQ publishes.`,
      impact: `${formatNumber(published)} live · ${formatNumber(drafts)} draft · ${formatNumber(learners)} learners.`,
      action: "Open the oldest draft, inspect the file, and publish today.",
    };
  }
  if (drafts > 0 || (partners > 0 && learners === 0)) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        learners === 0 && partners > 0
          ? `${formatNumber(partners)} partners are on the roster, but nobody has completed a module yet.`
          : `${drafts} draft${drafts === 1 ? "" : "s"} still sit off the partner app.`,
      impact: `${formatNumber(published)} published · ${formatNumber(learners)} learners.`,
      action: drafts > 0 ? "Publish finished drafts or keep them off the floor until the SOP is complete." : "Open Partners and point new approvals at the live catalog.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Published training is on the partner app. Completions and certifications can move.",
    impact: `${formatNumber(published)} live · ${formatNumber(learners)} learners · ${formatNumber(partners)} partners.`,
    action: "Keep drafts short and Document Review clear. No academy-queue action required.",
  };
}

function PersonMini({
  name,
  email,
  meta,
  value,
  href,
}: {
  name: string;
  email?: string;
  meta?: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="cu-avatar ac-avatar" aria-hidden>
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
  if (href) {
    return (
      <Link href={href} className="cu-person cu-person--btn">
        {inner}
      </Link>
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
  icon: typeof GraduationCap;
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
  { icon: BookOpen, tone: "cyan" as const, title: "Syllabus", copy: "Title, type, targeted categories" },
  { icon: Video, tone: "warning" as const, title: "Content", copy: "Video, SOP, assessment, or article" },
  { icon: Sparkles, tone: "success" as const, title: "Publish", copy: "Drafts stay off the partner app" },
  { icon: Award, tone: "success" as const, title: "Progress", copy: "Completions, scores, learners" },
];

function InspectIdle({ matching, onCompose }: { matching: number; onCompose: () => void }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={GraduationCap} tone="cyan" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Module file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a module — or use ↑ ↓ — to inspect syllabus, progress, and publish.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Module file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected module</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} in catalog · pick any row on the left`
                : "The catalog is empty — compose the first module from this dock"}
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
          Compose module
        </button>
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

const EMPTY_FORM: AcademyModuleInput = {
  slug: "",
  title: "",
  contentType: "article",
  contentUrl: "",
  contentBody: "",
  isPublished: false,
  categoryIds: [],
};

export default function AcademyAdminPage() {
  const qc = useQueryClient();
  const secondary = useAfterFirstPaint();
  const dashboard = useAdminDashboardQuery({ enabled: secondary });
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("order");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<AcademyModuleInput>(EMPTY_FORM);
  const [copied, setCopied] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<AcademyModule | null>(null);

  const catalogQ = useQuery({
    queryKey: ["admin", "academy"],
    queryFn: () => adminApi.academyModules(),
    staleTime: 20_000,
  });
  const incentivesQ = useQuery({
    queryKey: ["admin", "incentives"],
    queryFn: () => adminApi.incentiveRules(),
    staleTime: 60_000,
    retry: 1,
    enabled: secondary,
  });
  const partnersQ = useAdminProvidersQuery({ page: 1, limit: 1, badge: true }, { enabled: secondary });

  const modules = useMemo(() => catalogQ.data?.modules ?? [], [catalogQ.data?.modules]);
  const summary = catalogQ.data?.summary;
  const categories = summary?.catalogCategories ?? [];

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const rows = modules.filter((m) => {
      if (statusFilter === "published" && !m.isPublished) return false;
      if (statusFilter === "draft" && m.isPublished) return false;
      if (typeFilter !== "all" && m.contentType.toLowerCase() !== typeFilter) return false;
      if (q && !`${m.title} ${m.slug} ${m.contentType}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "recent") {
      return [...rows].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    if (sort === "completions") {
      return [...rows].sort((a, b) => b.stats.completed - a.stats.completed);
    }
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }, [debouncedSearch, modules, sort, statusFilter, typeFilter]);

  const selected = filtered.find((m) => m.id === selectedId) ?? modules.find((m) => m.id === selectedId) ?? null;
  const filtersOn = Boolean(debouncedSearch) || statusFilter !== "all" || typeFilter !== "all" || sort !== "order";

  useEffect(() => {
    if (selectedId && !modules.some((m) => m.id === selectedId) && !catalogQ.isFetching) {
      setSelectedId(null);
    }
  }, [catalogQ.isFetching, modules, selectedId]);

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
        return;
      }
      if (typing || composing || filtered.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? filtered.findIndex((m) => m.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(filtered.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(filtered[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing, filtered, selectedId]);

  const createMut = useMutation({
    mutationFn: (input: AcademyModuleInput) => adminApi.createAcademyModule(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "academy"] }),
  });
  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { isPublished: boolean } }) =>
      adminApi.patchAcademyModule(id, patch),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "academy"] }),
  });

  const published = summary?.published ?? modules.filter((m) => m.isPublished).length;
  const drafts = summary?.drafts ?? modules.filter((m) => !m.isPublished).length;
  const learners = summary?.learners ?? 0;
  const completions = summary?.completions ?? 0;
  const partners = dashboard.data?.stats.totalProviders ?? partnersQ.data?.total ?? 0;
  const certified = summary?.certifiedPartners ?? 0;
  const coverage = modules.length > 0 ? Math.round((published / modules.length) * 100) : 0;

  const brief = academyBrief({
    total: summary?.total ?? modules.length,
    published,
    drafts,
    learners,
    partners,
  });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const typeMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of modules) map.set(m.contentType, (map.get(m.contentType) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [modules]);

  const incentiveRules = (incentivesQ.data?.rules ?? []) as Array<{
    id: string;
    name?: string;
    code?: string;
    isActive?: boolean;
    metric?: string;
    bonusAmount?: number;
  }>;

  const fetching = catalogQ.isFetching || dashboard.isFetching || incentivesQ.isFetching;
  const refresh = () => {
    void catalogQ.refetch();
    void incentivesQ.refetch();
    void dashboard.refetch();
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setSort("order");
  };

  const startCompose = () => {
    setSelectedId(null);
    setComposing(true);
    setForm(EMPTY_FORM);
    setMutationError(null);
  };

  const copySlug = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="exec-hq cu-page ac-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={GraduationCap} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Partner Academy CMS</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Training catalog
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                SOPs, videos, and assessments published to the partner app — inspect one module at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={startCompose} className="biz-btn">
              <Plus size={14} />
              New module
            </button>
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
          label="Modules"
          value={formatNumber(summary?.total ?? modules.length)}
          sub={published ? `${formatNumber(published)} on the partner app` : "catalog size"}
          icon={GraduationCap}
          loading={catalogQ.isLoading}
        />
        <StatTile
          label="Published"
          value={formatNumber(published)}
          sub={drafts ? `${formatNumber(drafts)} still draft` : "nothing waiting"}
          icon={Sparkles}
          loading={catalogQ.isLoading}
          tone={published > 0 ? "success" : "danger"}
        />
        <StatTile
          label="Learners"
          value={formatNumber(learners)}
          sub={completions ? `${formatNumber(completions)} completions` : "partners who started a module"}
          icon={Award}
          loading={catalogQ.isLoading}
          tone={learners > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Certified"
          value={formatNumber(certified)}
          sub={partners ? `${formatNumber(partners)} on the roster` : "profiles with certifications"}
          icon={Trophy}
          loading={catalogQ.isLoading}
          tone={certified > 0 ? "success" : "default"}
        />
      </section>

      {(drafts > 0 || published === 0) && modules.length > 0 && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {drafts > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "draft" && "is-on")}
              onClick={() => setStatusFilter("draft")}
            >
              <FileText size={14} />
              {drafts} drafts
            </button>
          ) : null}
          {published === 0 ? (
            <button type="button" className="cu-rail__chip is-hot" onClick={startCompose}>
              <Sparkles size={14} />
              Nothing live on the partner app
            </button>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected || composing ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Catalog</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {catalogQ.isLoading ? "Loading…" : `${formatNumber(filtered.length)} matching`}
                  {published ? ` · ${formatNumber(published)} live` : ""}
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
                placeholder="Search title or slug…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Lane">
                {(
                  [
                    ["all", "All"],
                    ["published", "Live"],
                    ["draft", "Draft"],
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
              <FilterGroup label="Type">
                <button
                  type="button"
                  onClick={() => setTypeFilter("all")}
                  className={cn("cu-chip", typeFilter === "all" && "is-on")}
                >
                  All
                </button>
                {CONTENT_TYPES.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setTypeFilter(key)}
                    className={cn("cu-chip", typeFilter === key && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                {(
                  [
                    ["order", "Order"],
                    ["recent", "Updated"],
                    ["completions", "Done"],
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

          {mutationError ? <div className="cu-alert">{mutationError}</div> : null}

          <div className="cu-ledger__body">
            {catalogQ.isFetching && !catalogQ.isLoading ? <div className="cu-updating">Updating…</div> : null}

            {catalogQ.isLoading ? (
              <div className="cu-list">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="biz-skeleton h-[4.75rem] rounded-2xl" />
                ))}
              </div>
            ) : catalogQ.isError ? (
              <div className="cu-empty-wrap">
                <p className="text-sm">Could not load the academy catalog.</p>
                <button type="button" onClick={() => void catalogQ.refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={GraduationCap}
                  title={filtersOn ? "No match" : "Catalog is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search and filters."
                      : "Compose the first SOP, video, or assessment. It stays draft until you publish."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {filtered.map((m) => {
                  const on = selectedId === m.id && !composing;
                  const TypeIcon = typeIcon(m.contentType);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false);
                          setSelectedId(on ? null : m.id);
                        }}
                        className={cn("cu-row ac-row", on && "is-on", m.isPublished && "is-live", !m.isPublished && "is-draft")}
                      >
                        <span className={cn("cu-avatar ac-avatar", m.isPublished && "is-live")} aria-hidden>
                          <TypeIcon size={16} />
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[0.95rem] font-semibold tracking-tight">{m.title}</p>
                            <StatusBadge status={m.isPublished ? "published" : "draft"} />
                            <StatusBadge status={m.contentType} />
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="font-mono">{m.slug}</span>
                            {m.categoryIds.length ? <span>{m.categoryIds.slice(0, 2).join(", ")}</span> : <span>All categories</span>}
                            <span>
                              {formatNumber(m.stats.completed)} done
                              {m.stats.started ? ` · ${formatNumber(m.stats.started)} started` : ""}
                            </span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{formatNumber(m.stats.completed)}</p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                            {m.stats.avgScore != null ? `${m.stats.avgScore} avg` : formatDate(m.updatedAt)}
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

        <aside className={cn("cu-dock cu-panel", selected || composing ? "is-open" : "is-idle")}>
          {composing ? (
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <Icon3D icon={Plus} tone="cyan" size="md" />
                  <div className="min-w-0">
                    <p className="cu-intel__label">Compose</p>
                    <h2 className="mt-1.5 text-lg font-bold tracking-tight">New module</h2>
                    <p className="mt-1.5 text-sm text-[var(--color-biz-muted)]">Stays draft until you publish. Partners only see live modules.</p>
                  </div>
                </div>
                <button type="button" className="biz-btn !px-2.5" onClick={() => setComposing(false)} aria-label="Close compose">
                  <X size={14} />
                </button>
              </div>
              <div className="cu-dock__body" tabIndex={0} role="region" aria-label="New module form">
                <label className="ac-field">
                  <span>Title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, slug: f.slug || slugFrom(e.target.value) }))}
                    placeholder="e.g. Bathroom cleaning SOP"
                    className="ac-input"
                  />
                </label>
                <label className="ac-field">
                  <span>Slug</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: slugFrom(e.target.value) || e.target.value }))}
                    placeholder="bathroom-cleaning-sop"
                    className="ac-input font-mono"
                  />
                </label>
                <div className="ac-field">
                  <span>Type</span>
                  <div className="cu-filter__row">
                    {CONTENT_TYPES.map(([key, label]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setForm((f) => ({ ...f, contentType: key }))}
                        className={cn("cu-chip", form.contentType === key && "is-on")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="ac-field">
                  <span>Content URL</span>
                  <input
                    value={form.contentUrl ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, contentUrl: e.target.value }))}
                    placeholder="https://…"
                    className="ac-input"
                  />
                </label>
                <label className="ac-field">
                  <span>Body</span>
                  <textarea
                    value={form.contentBody ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, contentBody: e.target.value }))}
                    rows={5}
                    placeholder="SOP steps, assessment notes, or lesson copy…"
                    className="ac-input ac-textarea"
                  />
                </label>
                {categories.length > 0 ? (
                  <div className="ac-field">
                    <span>Categories</span>
                    <div className="cu-filter__row">
                      {categories.slice(0, 12).map((c) => {
                        const on = form.categoryIds?.includes(c);
                        return (
                          <button
                            type="button"
                            key={c}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                categoryIds: on ? (f.categoryIds ?? []).filter((x) => x !== c) : [...(f.categoryIds ?? []), c],
                              }))
                            }
                            className={cn("cu-chip", on && "is-on")}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">Empty means every partner category can see it.</p>
                  </div>
                ) : null}
              </div>
              <div className="cu-dock__actions">
                <button
                  type="button"
                  className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
                  disabled={createMut.isPending || form.title.trim().length < 2}
                  onClick={async () => {
                    setMutationError(null);
                    try {
                      const created = await createMut.mutateAsync({
                        ...form,
                        slug: form.slug || slugFrom(form.title),
                        contentUrl: form.contentUrl?.trim() || undefined,
                        contentBody: form.contentBody?.trim() || undefined,
                        isPublished: false,
                      });
                      setComposing(false);
                      setSelectedId(created.module.id);
                    } catch (error) {
                      setMutationError(getErrorMessage(error));
                    }
                  }}
                >
                  Save draft
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <span className={cn("cu-avatar cu-avatar--lg ac-avatar", selected.isPublished && "is-live")}>
                    {(() => {
                      const Icon = typeIcon(selected.contentType);
                      return <Icon size={22} />;
                    })()}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">Module file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold tracking-tight">{selected.title}</h2>
                      <StatusBadge status={selected.isPublished ? "published" : "draft"} />
                    </div>
                    <p className="mt-1.5 truncate font-mono text-sm text-[var(--color-biz-muted)]">{selected.slug}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={selected.contentType} />
                      {selected.categoryIds.length ? (
                        selected.categoryIds.slice(0, 4).map((c) => (
                          <span key={c} className="cu-chip is-on">
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="cu-chip is-on">All categories</span>
                      )}
                    </div>
                  </div>
                </div>
                <button type="button" className="biz-btn !px-2.5" onClick={() => setSelectedId(null)} aria-label="Close inspect">
                  <X size={14} />
                </button>
              </div>

              <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Module details">
                <dl className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Completed</dt>
                    <dd data-stat-value>{formatNumber(selected.stats.completed)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Started</dt>
                    <dd data-stat-value>{formatNumber(selected.stats.started)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Avg score</dt>
                    <dd data-stat-value>{selected.stats.avgScore ?? "—"}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Order</dt>
                    <dd data-stat-value>{selected.sortOrder}</dd>
                  </div>
                </dl>

                {selected.body ? (
                  <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">{selected.body.slice(0, 420)}{selected.body.length > 420 ? "…" : ""}</p>
                ) : (
                  <p className="text-sm text-[var(--color-biz-muted)]">No lesson body yet — add copy when you compose the next revision.</p>
                )}

                {selected.stats.started > 0 ? (
                  <MeterBar
                    label="Completed share"
                    value={Math.round((selected.stats.completed / Math.max(1, selected.stats.started)) * 100)}
                    tone={selected.stats.completed >= selected.stats.started * 0.7 ? "success" : "accent"}
                  />
                ) : null}

                {selected.recentCompletions.length > 0 ? (
                  <div>
                    <p className="cu-intel__label mb-2">Recent completions</p>
                    <div className="space-y-2">
                      {selected.recentCompletions.map((p) => (
                        <PersonMini
                          key={`${p.providerId}-${p.completedAt}`}
                          name={p.name}
                          email={p.city ?? undefined}
                          meta={formatDate(p.completedAt)}
                          value={p.score != null ? String(p.score) : "Done"}
                          href={`/vendors?q=${encodeURIComponent(p.name)}`}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="cu-jump-row">
                  {selected.contentUrl ? (
                    <a href={selected.contentUrl} target="_blank" rel="noopener noreferrer" className="biz-btn text-xs">
                      <ExternalLink size={13} />
                      Open content
                    </a>
                  ) : null}
                  <Link href="/vendors" className="biz-btn text-xs">
                    Partners
                  </Link>
                  <button type="button" className="biz-btn text-xs" onClick={() => void copySlug(selected.slug)}>
                    <Copy size={13} />
                    {copied ? "Copied" : "Slug"}
                  </button>
                </div>
              </div>

              <div className="cu-dock__actions">
                <button
                  type="button"
                  className={cn(
                    "biz-btn w-full justify-center",
                    selected.isPublished ? "text-[var(--color-biz-danger)]" : "text-[var(--color-biz-success)]",
                  )}
                  disabled={patchMut.isPending}
                  onClick={() => setConfirmPublish(selected)}
                >
                  <Sparkles size={14} />
                  {selected.isPublished ? "Unpublish" : "Publish to partner app"}
                </button>
              </div>
            </div>
          ) : (
            <InspectIdle matching={filtered.length} onCompose={startCompose} />
          )}
        </aside>
      </section>

      <section className="cu-floor ac-floor">
        <div className="cu-panel">
          <SectionHead
            icon={GraduationCap}
            tone={coverage >= 50 ? "success" : "warning"}
            title="Campus"
            subtitle="Share of the catalog that is live on the partner app"
          />
          <div className="ac-pulse">
            <GlassRing3D
              value={coverage}
              label="Live"
              sub={`${formatNumber(published)} of ${formatNumber(summary?.total ?? modules.length)}`}
              tone={coverage >= 50 ? "success" : coverage > 0 ? "warning" : "danger"}
            />
            <div className="ac-meters">
              <MeterBar label="Published" value={coverage} tone={coverage >= 50 ? "success" : "accent"} />
              <MeterBar
                label="Learners vs roster"
                value={partners > 0 ? Math.round((learners / partners) * 100) : 0}
                tone={learners > 0 ? "success" : "accent"}
              />
              <MeterBar
                label="Certified vs roster"
                value={partners > 0 ? Math.round((certified / partners) * 100) : 0}
                tone={certified > 0 ? "success" : "accent"}
              />
            </div>
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead icon={BookOpen} tone="cyan" title="Syllabus mix" subtitle="Modules by content type" />
          {typeMix.length > 0 ? (
            <div>
              {typeMix.map(([type, count]) => {
                const max = Math.max(1, ...typeMix.map((x) => x[1]));
                return (
                  <div key={type} className="ac-city">
                    <span className="max-w-[8.5rem] shrink-0 truncate text-sm font-semibold">{typeLabel(type)}</span>
                    <div className="ac-city__bar" aria-hidden>
                      <span style={{ width: `${Math.max(8, (count / max) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs font-bold tabular-nums">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={BookOpen} title="No mix yet" reason="Video, SOP, assessment, and article share appears once modules exist." />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Award}
            tone="success"
            title="Certifications"
            subtitle="Partner profiles that already hold a certification"
            action={
              <Link href="/vendors" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Partners
              </Link>
            }
          />
          {certified > 0 ? (
            <div>
              <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">
                {formatNumber(certified)} partner{certified === 1 ? "" : "s"} carry certifications on their profile. Completing academy modules is how the partner app records training; ops stores the badge on the partner file.
              </p>
              <div className="mt-4">
                <MeterBar
                  label="Certified share"
                  value={partners > 0 ? Math.round((certified / partners) * 100) : 0}
                  tone="success"
                />
              </div>
            </div>
          ) : (
            <EmptyLane
              icon={Award}
              tone="cyan"
              title="No badges yet"
              reason="When a partner completes training, operations can attach a certification on their profile."
              href="/vendors"
              cta="Partners"
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Trophy}
            tone="warning"
            title="Incentive rules"
            subtitle="Partner OS bonuses next to academy"
          />
          {incentivesQ.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : incentivesQ.isError ? (
            <EmptyLane icon={Trophy} title="Incentives not in this role" reason="Bonus rules need campaigns access. The academy catalog above still runs." />
          ) : incentiveRules.length > 0 ? (
            <div className="space-y-2">
              {incentiveRules.slice(0, 5).map((r) => (
                <PersonMini
                  key={r.id}
                  name={r.name || r.code || "Rule"}
                  email={r.metric}
                  meta={r.isActive ? "active" : "off"}
                  value={r.bonusAmount != null ? `₹${r.bonusAmount}` : "—"}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Trophy} tone="warning" title="No bonus rules" reason="Incentive rules sit beside academy in Partner OS. New rules will rank here." />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmPublish}
        title={confirmPublish?.isPublished ? "Unpublish this module?" : "Publish to the partner app?"}
        description={
          confirmPublish
            ? confirmPublish.isPublished
              ? `${confirmPublish.title} will leave the partner academy until you publish again. Completions already recorded stay.`
              : `${confirmPublish.title} will appear in the partner app for matching service categories.`
            : undefined
        }
        confirmLabel={confirmPublish?.isPublished ? "Unpublish" : "Publish"}
        destructive={Boolean(confirmPublish?.isPublished)}
        isLoading={patchMut.isPending}
        onClose={() => setConfirmPublish(null)}
        onConfirm={async () => {
          if (!confirmPublish) return;
          setMutationError(null);
          try {
            await patchMut.mutateAsync({ id: confirmPublish.id, patch: { isPublished: !confirmPublish.isPublished } });
            setConfirmPublish(null);
          } catch (error) {
            setMutationError(getErrorMessage(error));
          }
        }}
      />
    </div>
  );
}
