"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Clock,
  Crown,
  FilterX,
  LayoutGrid,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import {
  useServiceTaxonomyQuery,
  useServiceTransitionMutation,
  useServiceVersionsQuery,
  useRequirementItemsQuery,
  useCreateRequirementItemMutation,
  useAdminAnalyticsQuery,
  useAdminServicesQuery,
  useCreateServiceMutation,
  useDeleteServiceMutation,
  useSetServiceStatusMutation,
  useUpdateServiceMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import type { AdminServiceRow, RequestableLifecycle, ServiceCatalogConfig, ServiceInput } from "@/services/admin-api";
import {
  ServiceConfigEditor,
  extrasFromRow,
  extrasToInput,
  type ServiceExtras,
} from "@/components/services/ServiceConfigEditor";
import { formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "inactive" | "featured" | "premium";
type SortKey = "recent" | "bookings" | "price" | "name";
type ConfirmKind = "delete" | "deactivate";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/bookings", label: "Bookings" },
  { href: "/academy", label: "Academy" },
  { href: "/membership", label: "Membership" },
  { href: "/coverage", label: "Coverage" },
] as const;

type FormState = {
  name: string;
  category: string;
  basePrice: string;
  estimatedDuration: string;
  description: string;
  subcategory: string;
  icon: string;
  isFeatured: boolean;
  isActive: boolean;
  premiumOnly: boolean;
  /** Booking + content configuration (see ServiceConfigEditor). */
  extras: ServiceExtras;
};

function toForm(s?: AdminServiceRow): FormState {
  return {
    name: s?.name ?? "",
    category: s?.category ?? "",
    basePrice: s ? String(s.basePrice) : "",
    estimatedDuration: s ? String(s.estimatedDuration) : "60",
    description: s?.description ?? "",
    subcategory: s?.subcategory ?? "",
    icon: s?.icon ?? "",
    isFeatured: s?.isFeatured ?? false,
    isActive: s?.isActive ?? true,
    premiumOnly: s?.premiumOnly ?? false,
    extras: extrasFromRow(s),
  };
}

/** `base` is the stored configuration: the editor merges onto it instead of rebuilding it. */
function toInput(form: FormState, base?: ServiceCatalogConfig | null): ServiceInput {
  return {
    name: form.name.trim(),
    category: form.category.trim().toLowerCase(),
    basePrice: Number(form.basePrice),
    estimatedDuration: Number(form.estimatedDuration),
    description: form.description.trim(),
    subcategory: form.subcategory.trim() || undefined,
    icon: form.icon.trim() || undefined,
    isFeatured: form.isFeatured,
    isActive: form.isActive,
    premiumOnly: form.premiumOnly,
    ...extrasToInput(form.extras, base),
  };
}

function formValid(form: FormState) {
  return (
    form.name.trim().length >= 2 &&
    form.category.trim().length >= 1 &&
    Number(form.basePrice) > 0 &&
    Number(form.estimatedDuration) >= 1 &&
    form.description.trim().length >= 2
  );
}

function durationLabel(mins: number) {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
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

function catalogBrief(input: { total: number; active: number; featured: number; inactive: number }) {
  const { total, active, featured, inactive } = input;
  if (total === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The catalog is live, but no SKU has been published yet. Empty is a new marketplace — not a broken page.",
      impact: "Customers cannot book until HQ creates the first active service.",
      action: "Create the first service. Activate it when the price and duration are right.",
    };
  }
  if (active === 0 || inactive >= 10) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        active === 0
          ? `${total} SKU${total === 1 ? "" : "s"} sit in the catalog, but none are bookable.`
          : `${inactive} services are off. Demand cannot convert if the live shelf is thin.`,
      impact: `${formatNumber(active)} live · ${formatNumber(featured)} featured · ${formatNumber(inactive)} off.`,
      action: "Open Inactive, inspect the file, and activate SKUs that should sell — or keep them off with intent.",
    };
  }
  if (featured === 0 || inactive > 0) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        featured === 0
          ? "Nothing is featured. The customer homepage has no merchandised SKU from this catalog."
          : `${inactive} inactive SKU${inactive === 1 ? "" : "s"} still sit beside the live shelf.`,
      impact: `${formatNumber(active)} of ${formatNumber(total)} live · ${formatNumber(featured)} featured.`,
      action: featured === 0 ? "Feature the SKUs that should lead the storefront." : "Deactivate only what must stay off. Activate the rest.",
    };
  }
  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "The live catalog, featured shelf, and inactive lane are in range.",
    impact: `${formatNumber(active)} live · ${formatNumber(featured)} featured · ${formatNumber(inactive)} off.`,
    action: "Keep prices and duration honest. No catalog-queue action required.",
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
  icon: typeof LayoutGrid;
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
      <span className="cu-avatar sv-avatar" aria-hidden>
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

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cu-filter">
      <span className="cu-filter__label">{label}</span>
      <div className="cu-filter__row">{children}</div>
    </div>
  );
}

export default function ServicesPage() {
  const secondary = useAfterFirstPaint();
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm());
  const [formError, setFormError] = useState<string | null>(null);
  /** Serialized form as loaded — anything different is unsaved work. */
  const [formBaseline, setFormBaseline] = useState<string>(() => JSON.stringify(toForm()));
  const [changeReason, setChangeReason] = useState("");
  /**
   * The version and stored configuration the editor LOADED. Sending the list row's current version
   * at save time defeated optimistic locking: a background refetch picked up another admin's save,
   * so this stale form overwrote it with a 200. Found by the Phase 05 browser verification.
   */
  const [editSnapshot, setEditSnapshot] = useState<{ version?: number; config: AdminServiceRow["catalogConfig"] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; service: AdminServiceRow } | null>(null);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      category: categoryFilter === "all" ? undefined : categoryFilter,
      sort: sort === "recent" ? undefined : sort,
    }),
    [categoryFilter, debouncedSearch, page, sort, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminServicesQuery(params);
  const analytics = useAdminAnalyticsQuery({}, { enabled: secondary });
  const createMut = useCreateServiceMutation();
  const updateMut = useUpdateServiceMutation();
  const statusMut = useSetServiceStatusMutation();
  const deleteMut = useDeleteServiceMutation();

  const services = data?.services ?? [];
  const summary = data?.summary;
  const selected = services.find((s) => s.id === selectedId) ?? null;
  const taxonomy = useServiceTaxonomyQuery();
  const versions = useServiceVersionsQuery(selected && !editing ? selected.id : null);
  const requirementItemsQuery = useRequirementItemsQuery();
  const createRequirementItem = useCreateRequirementItemMutation();
  const transitionMut = useServiceTransitionMutation();
  const filtersOn =
    Boolean(debouncedSearch) || statusFilter !== "all" || categoryFilter !== "all" || sort !== "recent";

  useEffect(() => {
    if (selectedId && !services.some((s) => s.id === selectedId) && !isFetching) {
      setSelectedId(null);
      setEditing(false);
    }
  }, [isFetching, selectedId, services]);

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
      if (typing || composing || editing || services.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? services.findIndex((s) => s.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(services.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(services[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing, editing, selectedId, services]);

  const total = summary?.total ?? data?.total ?? 0;
  const active = summary?.active ?? 0;
  const inactive = summary?.inactive ?? Math.max(0, total - active);
  const featured = summary?.featured ?? 0;
  const premium = summary?.premium ?? 0;
  const liveShare = total > 0 ? Math.round((active / total) * 100) : 0;

  const brief = catalogBrief({ total, active, featured, inactive });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "cyan" : "success";

  const categories = summary?.categories ?? [];
  const topServices = analytics.data?.topServices ?? [];
  const featuredOnPage = services.filter((s) => s.isFeatured);

  const fetching = isFetching || analytics.isFetching;
  const saving = createMut.isPending || updateMut.isPending;

  const dirty = (composing || editing) && JSON.stringify(form) !== formBaseline;
  const confirmDiscard = () => !dirty || window.confirm("Discard unsaved changes to this service?");

  // A dirty editor must not be lost to a tab close or reload.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const startCompose = () => {
    if (!confirmDiscard()) return;
    setSelectedId(null);
    setEditing(false);
    setComposing(true);
    const f = toForm();
    setForm(f);
    setFormBaseline(JSON.stringify(f));
    setFormError(null);
  };

  const startEdit = (s: AdminServiceRow) => {
    if (!confirmDiscard()) return;
    setComposing(false);
    setSelectedId(s.id);
    setEditing(true);
    const f = toForm(s);
    setForm(f);
    setFormBaseline(JSON.stringify(f));
    setEditSnapshot({ version: s.version, config: s.catalogConfig ?? null });
    setFormError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setSort("recent");
    setPage(1);
  };

  const submitForm = async () => {
    if (!formValid(form)) return;
    setFormError(null);
    try {
      if (editing && selected) {
        // expectedVersion: a save against a version someone else already replaced is refused (409).
        await updateMut.mutateAsync({
          id: selected.id,
          body: {
            ...toInput(form, editSnapshot?.config ?? selected.catalogConfig),
            expectedVersion: editSnapshot?.version ?? selected.version,
            changeReason: changeReason.trim() || undefined,
          },
        });
        setChangeReason("");
        setEditing(false);
      } else {
        const created = await createMut.mutateAsync(toInput(form));
        setComposing(false);
        if (created?.service?.id) setSelectedId(created.service.id);
      }
    } catch (e) {
      setFormError(getErrorMessage(e));
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const showForm = composing || (editing && selected);
  const studio = showForm || Boolean(selected);

  return (
    <div className="exec-hq cu-page sv-page mx-auto min-w-0 max-w-[1680px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={LayoutGrid} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Services</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Live catalog
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                Price, duration, merchandising, and shelf status. Open a service to work on one full page at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={startCompose} className="biz-btn">
              <Plus size={14} />
              New service
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
          label="Catalog"
          value={formatNumber(total)}
          sub={`${formatNumber(data?.total ?? 0)} matching`}
          icon={LayoutGrid}
          loading={isLoading}
        />
        <StatTile
          label="Live"
          value={formatNumber(active)}
          sub={inactive ? `${formatNumber(inactive)} off the shelf` : "all SKUs bookable"}
          icon={Power}
          loading={isLoading}
          tone={active > 0 ? "success" : "danger"}
        />
        <StatTile
          label="Featured"
          value={formatNumber(featured)}
          sub="homepage merchandising"
          icon={Star}
          loading={isLoading}
          tone={featured > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Premium only"
          value={formatNumber(premium)}
          sub="membership-gated SKUs"
          icon={Crown}
          loading={isLoading}
          tone={premium > 0 ? "accent" : "default"}
        />
      </section>

      {(inactive > 0 || featured === 0) && total > 0 && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {inactive > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "inactive" && "is-on")}
              onClick={() => {
                setStatusFilter("inactive");
                setPage(1);
              }}
            >
              <Power size={14} />
              {inactive} inactive
            </button>
          ) : null}
          {featured === 0 ? (
            <button
              type="button"
              className="cu-rail__chip is-hot"
              onClick={() => {
                setStatusFilter("featured");
                setPage(1);
              }}
            >
              <Star size={14} />
              Nothing featured
            </button>
          ) : null}
        </section>
      )}

      {!studio ? (
      <section className="cu-stage sv-catalog">
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Shelf</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {isLoading ? "Loading…" : `${formatNumber(data?.total ?? 0)} matching`}
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
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                placeholder="Search name, slug, category…  /"
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
                    ["featured", "Featured"],
                    ["premium", "Premium"],
                  ] as const
                ).map(([key, label]) => (
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
              {categories.length > 0 ? (
                <FilterGroup label="Category">
                  <button
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setCategoryFilter("all");
                    }}
                    className={cn("cu-chip", categoryFilter === "all" && "is-on")}
                  >
                    All
                  </button>
                  {categories.slice(0, 8).map((c) => (
                    <button
                      type="button"
                      key={c.category}
                      onClick={() => {
                        setPage(1);
                        setCategoryFilter(c.category);
                      }}
                      className={cn("cu-chip", categoryFilter === c.category && "is-on")}
                    >
                      {c.category}
                    </button>
                  ))}
                </FilterGroup>
              ) : null}
              <FilterGroup label="Sort">
                {(
                  [
                    ["recent", "Newest"],
                    ["bookings", "Booked"],
                    ["price", "Price"],
                    ["name", "Name"],
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

          {actionError ? <div className="cu-alert">{actionError}</div> : null}

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
                <p className="text-sm">Could not load the catalog.</p>
                <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : services.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={LayoutGrid}
                  title={filtersOn ? "No match" : "Catalog is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search, lane, or category."
                      : "Compose the first SKU. It stays off the customer app until you activate it."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {services.map((s) => {
                  const on = selectedId === s.id && !composing;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmDiscard()) return;
                          setComposing(false);
                          setEditing(false);
                          setSelectedId(s.id);
                        }}
                        className={cn(
                          "cu-row sv-row",
                          on && "is-on",
                          s.isActive && "is-live",
                          !s.isActive && "is-off",
                        )}
                      >
                        {s.icon ? (
                          <span
                            className="cu-avatar sv-thumb"
                            style={{ backgroundImage: `url("${s.icon}")` }}
                            aria-hidden
                          />
                        ) : (
                          <span className={cn("cu-avatar sv-avatar", s.isActive && "is-live")} aria-hidden>
                            {initials(s.name)}
                          </span>
                        )}
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 max-w-full truncate text-[0.95rem] font-semibold tracking-tight">
                              {s.name}
                            </p>
                            <StatusBadge status={s.isActive ? "active" : "inactive"} />
                            {s.isFeatured ? <StatusBadge status="featured" /> : null}
                            {s.premiumOnly ? <StatusBadge status="premium" /> : null}
                          </div>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="capitalize">{s.category}</span>
                            <span className="max-w-[10rem] truncate font-mono">/{s.slug}</span>
                            <span>{durationLabel(s.estimatedDuration)}</span>
                            {s.rating ? <span>{s.rating.toFixed(1)}★</span> : null}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{inr(s.basePrice, true)}</p>
                          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                            {formatNumber(s.bookingCount)} booked
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
      </section>
      ) : (
      <section className="sv-studio">
          {showForm ? (
            <div className="sv-studio__frame">
              <div className="sv-studio__bar">
                <button
                  type="button"
                  className="biz-btn"
                  onClick={() => {
                    if (!confirmDiscard()) return;
                    setComposing(false);
                    setEditing(false);
                  }}
                >
                  <ArrowLeft size={14} />
                  Catalog
                </button>
                <div className="min-w-0">
                  <p className="sv-kicker">{editing ? "Edit service" : "New service"}</p>
                  <h2>{editing ? selected?.name ?? "Edit service" : "New service"}</h2>
                </div>
                <div className="sv-studio__actions">
                  {dirty ? <span className="sv-unsaved">Unsaved</span> : null}
                  <button
                    type="button"
                    className="biz-btn biz-btn-primary [&_svg]:text-white"
                    disabled={
                      !formValid(form) ||
                      saving ||
                      Boolean(form.isActive && editing && selected?.publishBlocked && selected.publishBlocked.length > 0)
                    }
                    onClick={() => void submitForm()}
                  >
                    {saving ? "Saving…" : editing ? "Save changes" : "Create service"}
                  </button>
                </div>
              </div>
              {form.isActive && editing && selected?.publishBlocked && selected.publishBlocked.length > 0 ? (
                <p className="sv-publish-block">
                  Publish stays disabled until: {selected.publishBlocked.map((i) => i.message).join("; ")}
                </p>
              ) : null}
              <ServiceConfigEditor
                key={editing && selected ? selected.id : "new"}
                value={form.extras}
                onChange={(extras) => set("extras", extras)}
                gaps={editing && selected ? selected.configGaps : undefined}
                sections={editing && selected ? selected.configSections : undefined}
                requirementItems={requirementItemsQuery.data?.items}
                onCreateRequirementItem={async (input) => {
                  await createRequirementItem.mutateAsync(input);
                }}
                lead={
                  <>
                <label className="sv-field">
                  <span>Name</span>
                  <input className="sv-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Bathroom cleaning" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="sv-field">
                    <span>Customer category</span>
                    <select
                      className="sv-input"
                      value={form.extras.categorySlug}
                      onChange={(e) => set("extras", { ...form.extras, categorySlug: e.target.value, subcategorySlug: "" })}
                    >
                      <option value="">From dispatch category</option>
                      {(taxonomy.data?.categories ?? [])
                        .filter((c) => c.isActive)
                        .map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="sv-field">
                    <span>Customer subcategory</span>
                    <select
                      className="sv-input"
                      value={form.extras.subcategorySlug}
                      disabled={!form.extras.categorySlug}
                      onChange={(e) => set("extras", { ...form.extras, subcategorySlug: e.target.value })}
                    >
                      <option value="">None</option>
                      {(taxonomy.data?.categories.find((c) => c.slug === form.extras.categorySlug)?.subcategories ?? []).map((sc) => (
                        <option key={sc.slug} value={sc.slug}>
                          {sc.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sv-field">
                    <span>Dispatch category</span>
                    <input className="sv-input" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="cleaning" />
                  </label>
                  <label className="sv-field">
                    <span>Internal code (ops)</span>
                    <input
                      className="sv-input"
                      value={form.extras.internalServiceCode}
                      onChange={(e) => set("extras", { ...form.extras, internalServiceCode: e.target.value })}
                      placeholder="optional"
                    />
                  </label>
                  <label className="sv-field">
                    <span>Base price (₹)</span>
                    <input className="sv-input" type="number" min={0} value={form.basePrice} onChange={(e) => set("basePrice", e.target.value)} />
                  </label>
                  <label className="sv-field">
                    <span>Duration (min)</span>
                    <input className="sv-input" type="number" min={1} value={form.estimatedDuration} onChange={(e) => set("estimatedDuration", e.target.value)} />
                  </label>
                </div>
                <label className="sv-field">
                  <span>Description</span>
                  <textarea className="sv-input sv-textarea" rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
                </label>
                <label className="sv-field">
                  <span>Image URL</span>
                  <input className="sv-input" value={form.icon} onChange={(e) => set("icon", e.target.value)} placeholder="https://…" />
                </label>
                {form.icon.trim() ? (
                  <div
                    className="sv-preview"
                    style={{ backgroundImage: `url("${form.icon.trim()}")` }}
                    aria-hidden
                  />
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                    Active
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} />
                    Featured
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.premiumOnly} onChange={(e) => set("premiumOnly", e.target.checked)} />
                    Premium only
                  </label>
                </div>
                  </>
                }
                footer={
                  <>
                    {editing && selected ? (
                      <p className="text-sm text-[var(--color-biz-muted)]">
                        Service code <span className="font-mono">{selected.serviceCode}</span> (permanent) · version {selected.version ?? 1}
                        {selected.updatedAt ? ` · last updated ${new Date(selected.updatedAt).toLocaleString()}` : ""}
                      </p>
                    ) : null}
                    {editing && selected ? (
                      <label className="sv-field">
                        <span>Reason for change (audit trail)</span>
                        <input
                          className="sv-input"
                          value={changeReason}
                          maxLength={500}
                          onChange={(e) => setChangeReason(e.target.value)}
                          placeholder="e.g. Quarterly price review"
                        />
                      </label>
                    ) : null}
                    {formError ? (
                      <p role="alert" className="text-sm text-[var(--color-biz-danger)]">
                        {formError}
                      </p>
                    ) : null}
                  </>
                }
              />
            </div>
          ) : selected ? (
            <div className="sv-studio__frame">
              <div className="sv-studio__bar">
                <button type="button" className="biz-btn" onClick={() => setSelectedId(null)}>
                  <ArrowLeft size={14} />
                  Catalog
                </button>
                <div className="flex min-w-0 items-center gap-4">
                  {selected.icon ? (
                    <span className="cu-avatar cu-avatar--lg sv-thumb" style={{ backgroundImage: `url("${selected.icon}")` }} />
                  ) : (
                    <span className={cn("cu-avatar cu-avatar--lg sv-avatar", selected.isActive && "is-live")}>
                      {initials(selected.name)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="sv-kicker">Service file</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h2>{selected.name}</h2>
                      <StatusBadge status={selected.isActive ? "active" : "inactive"} />
                      {selected.isFeatured ? <StatusBadge status="featured" /> : null}
                      {selected.premiumOnly ? <StatusBadge status="premium" /> : null}
                    </div>
                  </div>
                </div>
                <div className="sv-studio__actions">
                  <button type="button" className="biz-btn biz-btn-primary [&_svg]:text-white" onClick={() => startEdit(selected)}>
                    Edit service
                  </button>
                </div>
              </div>
              <div className="sv-file">
                <div className="cu-dock__stats">
                  <div className="cu-stat">
                    <dt>Price</dt>
                    <dd data-stat-value>{inr(selected.basePrice, true)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Duration</dt>
                    <dd data-stat-value>{durationLabel(selected.estimatedDuration)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Booked</dt>
                    <dd data-stat-value>{formatNumber(selected.bookingCount)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Rating</dt>
                    <dd data-stat-value>{selected.rating != null ? `${selected.rating.toFixed(1)}★` : "—"}</dd>
                  </div>
                </div>
                <p className="sv-file__copy">{selected.description}</p>
                {selected.availableCities.length > 0 ? (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-biz-muted)]">
                    <MapPin size={12} />
                    {selected.availableCities.slice(0, 8).join(", ")}
                    {selected.availableCities.length > 8 ? ` +${selected.availableCities.length - 8}` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-biz-muted)]">No city restriction — nationwide when coverage allows.</p>
                )}
                <div className="sv-file__meta">
                  <p className="font-semibold">
                    Lifecycle: {selected.lifecycleStatus ?? "—"} · version {selected.version ?? 1}
                    {selected.isBookable ? " · bookable" : " · not bookable"}
                  </p>
                  <p className="mt-1 text-[var(--color-biz-muted)]">
                    {selected.taxonomy?.category ? `${selected.taxonomy.category.name}${selected.taxonomy.subcategory ? ` › ${selected.taxonomy.subcategory.name}` : ""}` : "Not in a customer category"}
                    {selected.publishedAt ? ` · published ${new Date(selected.publishedAt).toLocaleDateString()}` : ""}
                    {selected.updatedAt ? ` · updated ${new Date(selected.updatedAt).toLocaleString()}` : ""}
                  </p>
                  {selected.duration ? (
                    <p className="mt-1 text-[var(--color-biz-muted)]">
                      Appointment {selected.duration.totalMinutes} min (prep {selected.duration.preparationMinutes} · service{" "}
                      {selected.duration.serviceMinutes} · cleanup {selected.duration.cleanupMinutes}) · partner calendar reserves{" "}
                      {selected.reservedSlotMinutes ?? 60} min ({selected.partnerSlotPolicy === "FIXED" ? "fixed visit" : "appointment + buffers"})
                    </p>
                  ) : null}
                  {(selected.allowedTransitions ?? []).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(selected.allowedTransitions ?? []).map((to) => (
                        <button
                          key={to}
                          type="button"
                          className="biz-btn text-xs"
                          disabled={transitionMut.isPending}
                          onClick={() => {
                            setActionError(null);
                            if (to === "ARCHIVED" && !window.confirm("Archiving is permanent. Continue?")) return;
                            void transitionMut
                              .mutateAsync({ id: selected.id, to: to as RequestableLifecycle, expectedVersion: selected.version })
                              .catch((e) => setActionError(getErrorMessage(e)));
                          }}
                        >
                          → {to.replace(/_/g, " ").toLowerCase()}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[var(--color-biz-muted)]">No further lifecycle moves (archived is final).</p>
                  )}
                  {versions.data?.versions.length ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer">Published versions ({versions.data.versions.length})</summary>
                      <ul className="mt-1 space-y-0.5">
                        {versions.data.versions.slice(0, 10).map((v) => (
                          <li key={v.version} className="font-mono">
                            v{v.version} · {new Date(v.publishedAt ?? v.createdAt).toLocaleString()}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <div className="cu-jump-row">
                  <Link href={`/bookings?q=${encodeURIComponent(selected.name)}`} className="biz-btn text-xs">
                    Bookings
                  </Link>
                  <Link href="/membership" className="biz-btn text-xs">
                    <Crown size={13} />
                    Membership
                  </Link>
                </div>
              </div>
              <div className="sv-file__actions">
                <button type="button" className="biz-btn" onClick={() => startEdit(selected)}>
                  Edit service
                </button>
                <button
                  type="button"
                  className={cn(
                    "biz-btn w-full justify-center",
                    selected.isActive ? "text-[var(--color-biz-warning)]" : "text-[var(--color-biz-success)]",
                  )}
                  disabled={statusMut.isPending}
                  onClick={() => {
                    setActionError(null);
                    if (selected.isActive) setConfirm({ kind: "deactivate", service: selected });
                    else void statusMut.mutateAsync({ id: selected.id, isActive: true }).catch((e) => setActionError(getErrorMessage(e)));
                  }}
                >
                  <Power size={14} />
                  {selected.isActive ? "Take off shelf" : "Activate"}
                </button>
                <button
                  type="button"
                  className="biz-btn w-full justify-center text-[var(--color-biz-danger)]"
                  onClick={() => setConfirm({ kind: "delete", service: selected })}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          ) : null}
      </section>
      )}

      {!studio ? (
      <section className="cu-floor sv-floor">
        <div className="cu-panel">
          <SectionHead
            icon={LayoutGrid}
            tone={liveShare >= 50 ? "success" : "warning"}
            title="Shelf health"
            subtitle="Share of the catalog that customers can book"
          />
          <div className="sv-pulse">
            <GlassRing3D
              value={liveShare}
              label="Live"
              sub={`${formatNumber(active)} of ${formatNumber(total)}`}
              tone={liveShare >= 50 ? "success" : liveShare > 0 ? "warning" : "danger"}
            />
            <div className="sv-meters">
              <MeterBar label="Live" value={liveShare} tone={liveShare >= 50 ? "success" : "accent"} />
              <MeterBar
                label="Featured share"
                value={total > 0 ? Math.round((featured / total) * 100) : 0}
                tone={featured > 0 ? "success" : "accent"}
              />
              <MeterBar
                label="Premium share"
                value={total > 0 ? Math.round((premium / total) * 100) : 0}
                tone={premium > 0 ? "accent" : "success"}
              />
            </div>
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead icon={Sparkles} tone="cyan" title="Category mix" subtitle="SKUs on the catalog by category" />
          {categories.length > 0 ? (
            <div>
              {categories.slice(0, 8).map((c) => {
                const max = Math.max(1, ...categories.map((x) => x.count));
                return (
                  <button
                    type="button"
                    key={c.category}
                    className="sv-city"
                    onClick={() => {
                      setCategoryFilter(c.category);
                      setPage(1);
                    }}
                  >
                    <span className="max-w-[8.5rem] shrink-0 truncate text-sm font-semibold capitalize">{c.category}</span>
                    <div className="sv-city__bar" aria-hidden>
                      <span style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs font-bold tabular-nums">{c.count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={Sparkles} title="No mix yet" reason="Category share appears once SKUs exist." />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Star}
            tone="warning"
            title="Featured shelf"
            subtitle="Homepage merchandising"
          />
          {featuredOnPage.length > 0 ? (
            <div className="space-y-2">
              {featuredOnPage.slice(0, 5).map((s) => (
                <PersonMini
                  key={s.id}
                  name={s.name}
                  meta={s.category}
                  value={inr(s.basePrice, true)}
                  onOpen={() => {
                    setComposing(false);
                    setEditing(false);
                    setSelectedId(s.id);
                  }}
                />
              ))}
            </div>
          ) : featured > 0 ? (
            <EmptyLane icon={Star} tone="warning" title="Featured off this page" reason="Featured SKUs exist — clear filters or switch to the Featured lane." />
          ) : (
            <EmptyLane icon={Star} tone="warning" title="Nothing featured" reason="Mark a live SKU as featured so the customer homepage has a lead offer." />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Clock}
            tone="success"
            title="Demand · 30d"
            subtitle="Bookings and GMV by service"
            action={
              <Link href="/bookings" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Bookings
              </Link>
            }
          />
          {analytics.isLoading ? (
            <div className="biz-skeleton h-40 rounded-2xl" />
          ) : topServices.length > 0 ? (
            <div className="space-y-2">
              {topServices.slice(0, 5).map((s) => (
                <PersonMini
                  key={s.name}
                  name={s.name}
                  meta={`${formatNumber(s.bookings)} jobs`}
                  value={inr(s.revenue, true)}
                  onOpen={() => {
                    setSearch(s.name);
                    setPage(1);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyLane icon={Clock} title="No demand yet" reason="Completed bookings in the last 30 days will rank services here." href="/bookings" cta="Bookings" />
          )}
        </div>
      </section>
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === "delete"
            ? `Delete "${confirm.service.name}"?`
            : `Take "${confirm?.service.name ?? ""}" off the shelf?`
        }
        description={
          confirm?.kind === "delete"
            ? "This permanently removes the SKU. Services with bookings cannot be deleted — deactivate them instead."
            : "Customers will no longer see or book this service. History and bookings stay."
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete" : "Deactivate"}
        destructive
        isLoading={deleteMut.isPending || statusMut.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setActionError(null);
          try {
            if (confirm.kind === "delete") await deleteMut.mutateAsync(confirm.service.id);
            else await statusMut.mutateAsync({ id: confirm.service.id, isActive: false });
            setConfirm(null);
            if (selectedId === confirm.service.id && confirm.kind === "delete") setSelectedId(null);
          } catch (e) {
            setActionError(getErrorMessage(e));
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}
