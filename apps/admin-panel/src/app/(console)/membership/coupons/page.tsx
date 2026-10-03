"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Copy,
  Crown,
  Download,
  FilterX,
  Gift,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  adminApi,
  type AdminMembershipCouponRow,
} from "@/services/admin-api";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { AdminApiError, getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;
const TIERS = ["premium", "gold", "platinum", "silver"] as const;

type StatusFilter = "all" | "active" | "paused" | "draft" | "archived";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/membership", label: "Membership" },
  { href: "/membership/cashback", label: "Cashback" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/bookings", label: "Bookings" },
  { href: "/customers", label: "Customers" },
] as const;

const STATUS_LANES: Array<[StatusFilter, string]> = [
  ["all", "All"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["draft", "Draft"],
  ["archived", "Archived"],
];

type FormState = {
  code: string;
  name: string;
  discountPct: string;
  planRestricted: string[];
  maxRedemptions: string;
  perUserLimit: string;
  expiresAt: string;
  copies: string;
};

function emptyForm(): FormState {
  return {
    code: "",
    name: "",
    discountPct: "10",
    planRestricted: ["gold", "platinum"],
    maxRedemptions: "",
    perUserLimit: "1",
    expiresAt: "",
    copies: "1",
  };
}

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
  const src = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return (
    src
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

function statusKey(status: string) {
  return status.toLowerCase();
}

function isExpired(row: AdminMembershipCouponRow) {
  if (!row.expiresAt) return false;
  const t = new Date(row.expiresAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function plansLabel(plans: string[]) {
  if (!plans.length) return "All plans";
  return plans.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(" · ");
}

function formValid(form: FormState) {
  const code = form.code.trim();
  const name = form.name.trim();
  const discount = Number(form.discountPct);
  const copies = Number(form.copies) || 1;
  if (name.length < 2) return false;
  if (!Number.isFinite(discount) || discount <= 0 || discount > 100) return false;
  if (copies < 1 || copies > 50) return false;
  if (copies === 1) return code.length >= 3;
  return code.length >= 2;
}

function couponBrief(input: {
  issued: number;
  active: number;
  paused: number;
  redeemed: number;
  conversion: number;
  expiredLive: number;
  discountGiven: number;
}) {
  const { issued, active, paused, redeemed, conversion, expiredLive, discountGiven } = input;

  if (issued === 0) {
    return {
      state: "seed" as const,
      label: "Seeding",
      meaning: "The coupon desk is live, but no membership code has been issued yet. Empty is a new vault — not a broken page.",
      impact: "Members cannot apply a club discount until HQ publishes the first active code.",
      action: "Compose a code from this dock. Restrict it to the tiers that actually earn it.",
    };
  }

  if (expiredLive > 0 || (active === 0 && issued > 0) || conversion >= 80) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        expiredLive > 0
          ? `${formatNumber(expiredLive)} active code${expiredLive === 1 ? "" : "s"} already expired. Members still see a live status on a dead date.`
          : active === 0
            ? "Every coupon is paused, drafted, or archived. The club has no live discount to apply."
            : `Conversion is ${conversion}%. Almost every issued code is being redeemed — check the discount is still honest.`,
      impact: `${formatNumber(active)} live · ${inr(discountGiven, true)} given · ${formatNumber(redeemed)} redemptions.`,
      action:
        expiredLive > 0
          ? "Pause or archive expired codes. Do not leave a live status on a lapsed date."
          : active === 0
            ? "Resume a paused code, or compose a new one and set it Active."
            : "Open the hottest code. A 80%+ take rate usually means the cut is too generous.",
    };
  }

  if (paused > 0 || conversion === 0 && active > 0) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        paused > 0
          ? `${formatNumber(paused)} code${paused === 1 ? "" : "s"} sit paused. They will not apply on the next booking.`
          : "Active codes have not been redeemed yet. Either they are new, or members cannot see them.",
      impact: `${formatNumber(active)} live · ${formatNumber(redeemed)} redeemed · ${conversion}% conversion.`,
      action: paused > 0 ? "Open Paused and resume only the codes that should still fire." : "Confirm plan restrictions match live membership tiers.",
    };
  }

  return {
    state: "stable" as const,
    label: "Healthy",
    meaning: "Live codes are on the shelf. Redemptions are landing against completed bookings.",
    impact: `${formatNumber(issued)} issued · ${inr(discountGiven, true)} given · ${conversion}% conversion.`,
    action: "Keep restrictions honest. No coupon-desk action required.",
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
  icon: typeof Gift;
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
  { icon: Ticket, tone: "warning" as const, title: "Code", copy: "What the member types at checkout" },
  { icon: Crown, tone: "cyan" as const, title: "Plans", copy: "Which club tiers may use it" },
  { icon: Sparkles, tone: "success" as const, title: "Cut", copy: "Percent off the chargeable base" },
  { icon: Pause, tone: "danger" as const, title: "Shelf", copy: "Pause stops the next booking instantly" },
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
          <Icon3D icon={Gift} tone="warning" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Coupon file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a code — or use ↑ ↓ — to inspect cut, plans, and redemptions.
            </p>
          </div>
        </div>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Coupon file overview">
        <div className="cu-inspect__identity">
          <span className="cu-avatar cu-avatar--lg cp-avatar cu-avatar--ghost" aria-hidden>
            ?
          </span>
          <div className="min-w-0">
            <p className="cu-intel__label">Selected coupon</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} matching · pick any row on the left`
                : "The vault is empty — compose the first club code from this dock"}
            </p>
          </div>
        </div>
        <dl className="cu-dock__stats">
          {[
            ["Cut", "—"],
            ["Redeemed", "—"],
            ["Plans", "—"],
            ["Expires", "—"],
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
        <button type="button" className="biz-btn w-full justify-center" onClick={onCompose}>
          <Plus size={14} />
          New coupon
        </button>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}

export default function MembershipCouponsPage() {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmPause, setConfirmPause] = useState<AdminMembershipCouponRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const listParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter.toUpperCase(),
    }),
    [debouncedSearch, page, statusFilter],
  );

  const listQ = useQuery({
    queryKey: ["admin", "membership", "coupons", listParams],
    queryFn: () => adminApi.membershipCoupons.list(listParams),
    retry: skipForbidden,
  });
  const analyticsQ = useQuery({
    queryKey: ["admin", "membership", "coupons", "analytics"],
    queryFn: () => adminApi.membershipCoupons.analytics(),
    retry: skipForbidden,
  });

  const coupons = useMemo(() => listQ.data?.coupons ?? [], [listQ.data?.coupons]);
  const selected = coupons.find((c) => c.id === selectedId) ?? null;
  const filtersOn = Boolean(debouncedSearch) || statusFilter !== "all";

  const a = analyticsQ.data;
  const issued = num(a?.issued);
  const active = num(a?.active);
  const paused = num(a?.paused);
  const draft = num(a?.draft);
  const redeemed = num(a?.redeemed);
  const conversion = num(a?.conversionPct);
  const expiredLive = num(a?.expiredLive);
  const avgDiscount = num(a?.avgDiscountPct);
  const discountGiven = num(a?.revenueImpact?.discountGiven);
  const revenueBefore = num(a?.revenueImpact?.revenueBefore);
  const revenueAfter = num(a?.revenueImpact?.revenueAfter);
  const takeRate = pct(discountGiven, revenueBefore);

  const brief = couponBrief({
    issued,
    active,
    paused,
    redeemed,
    conversion,
    expiredLive,
    discountGiven,
  });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : brief.state === "seed" ? "default" : "warning";

  const mix = useMemo(() => {
    const src = a?.byPlan ?? {};
    const keys = ["all", ...TIERS];
    return keys
      .filter((k) => num(src[k]) > 0)
      .map((k) => ({
        label: k === "all" ? "All plans" : k[0]!.toUpperCase() + k.slice(1),
        value: num(src[k]),
      }));
  }, [a?.byPlan]);

  useEffect(() => {
    if (selectedId && !coupons.some((c) => c.id === selectedId) && !listQ.isFetching) {
      setSelectedId(null);
    }
  }, [coupons, listQ.isFetching, selectedId]);

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
      if (typing || composing || coupons.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? coupons.findIndex((c) => c.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(coupons.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(coupons[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing, coupons, selectedId]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "membership", "coupons"] }),
    ]);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const copies = Math.min(50, Math.max(1, Number(form.copies) || 1));
      const discountPct = Number(form.discountPct);
      const maxRedemptions = form.maxRedemptions ? Number(form.maxRedemptions) : undefined;
      const perUserLimit = form.perUserLimit ? Number(form.perUserLimit) : 1;
      const planRestricted = form.planRestricted;
      const expiresAt = form.expiresAt || undefined;
      if (copies > 1) {
        return adminApi.membershipCoupons.bulkGenerate({
          prefix: form.code.trim().toUpperCase(),
          count: copies,
          name: form.name.trim(),
          discountPct,
          planRestricted,
          status: "ACTIVE",
        });
      }
      return adminApi.membershipCoupons.create({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        discountPct,
        planRestricted,
        maxRedemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : undefined,
        perUserLimit,
        expiresAt,
        status: "ACTIVE",
      });
    },
    onSuccess: async () => {
      setForm(emptyForm());
      setComposing(false);
      setFormError(null);
      await invalidate();
    },
    onError: (err) => setFormError(getErrorMessage(err, "Could not issue this coupon.")),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "PAUSED" | "ARCHIVED" }) =>
      adminApi.membershipCoupons.update(id, { status }),
    onSuccess: async () => {
      setConfirmPause(null);
      await invalidate();
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const togglePlan = (tier: string) => {
    setForm((f) => ({
      ...f,
      planRestricted: f.planRestricted.includes(tier)
        ? f.planRestricted.filter((t) => t !== tier)
        : [...f.planRestricted, tier],
    }));
  };

  const fetching = listQ.isFetching || analyticsQ.isFetching;
  const refresh = () => {
    void listQ.refetch();
    void analyticsQ.refetch();
  };
  const startCompose = () => {
    setSelectedId(null);
    setComposing(true);
    setForm(emptyForm());
    setFormError(null);
  };
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };
  const setLane = (lane: StatusFilter) => {
    setStatusFilter(lane);
    setPage(1);
  };
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await adminApi.membershipCoupons.exportCsv();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `homigo-coupons-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      /* ignore */
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="exec-hq cu-page mb-page cp-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="mb-hero-sheen cp-hero-sheen" aria-hidden />
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={Gift} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Coupons</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  Club vault
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
                Plan-restricted membership codes — issued, paused, and redeemed against the booking, one file at a time.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="mb-chip-card cp-chip-card">
              <span>Live</span>
              <strong>{analyticsQ.isLoading && !active ? "—" : formatNumber(active)}</strong>
            </div>
            <button type="button" onClick={startCompose} className="biz-btn">
              <Plus size={14} />
              New coupon
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
          label="Issued"
          value={formatNumber(issued)}
          sub={draft ? `${formatNumber(draft)} still in draft` : "codes in the vault"}
          icon={Ticket}
          loading={analyticsQ.isLoading}
          tone={issued > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Active"
          value={formatNumber(active)}
          sub={paused ? `${formatNumber(paused)} paused` : "live on checkout"}
          icon={Gift}
          loading={analyticsQ.isLoading}
          tone={active > 0 ? "success" : issued > 0 ? "danger" : "default"}
        />
        <StatTile
          label="Redeemed"
          value={formatNumber(redeemed)}
          sub={issued ? `${conversion}% of issued codes` : "applied on bookings"}
          icon={Sparkles}
          loading={analyticsQ.isLoading}
          tone={redeemed > 0 ? "accent" : "default"}
        />
        <StatTile
          label="Discount given"
          value={inr(discountGiven, true)}
          sub={revenueBefore ? `${takeRate}% of ${inr(revenueBefore, true)} booked` : "cut from chargeable base"}
          icon={Crown}
          loading={analyticsQ.isLoading}
          tone={discountGiven > 0 ? "danger" : "success"}
        />
      </section>

      {(paused > 0 || expiredLive > 0 || draft > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {paused > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip is-warm", statusFilter === "paused" && "is-on")}
              onClick={() => setLane("paused")}
            >
              <Pause size={14} />
              {paused} paused
            </button>
          ) : null}
          {expiredLive > 0 ? (
            <span className="cu-rail__chip is-hot">
              <Ticket size={14} />
              {expiredLive} expired live
            </span>
          ) : null}
          {draft > 0 ? (
            <button
              type="button"
              className={cn("cu-rail__chip", statusFilter === "draft" && "is-on")}
              onClick={() => setLane("draft")}
            >
              {draft} draft
            </button>
          ) : null}
        </section>
      )}

      <section className={cn("cu-stage", selected || composing ? "is-open" : "")}>
        <div className="cu-panel cu-ledger overflow-hidden">
          <div className="cu-toolbar">
            <div className="cu-toolbar__title">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">Vault</h2>
                <p className="mt-1 min-w-0 truncate text-xs text-[var(--color-biz-muted)]">
                  {listQ.isLoading ? "Loading…" : `${formatNumber(listQ.data?.total ?? 0)} matching`}
                  {avgDiscount ? ` · ${avgDiscount}% avg cut on live codes` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {filtersOn ? (
                  <button type="button" className="biz-btn !px-2.5 text-xs" onClick={clearFilters}>
                    <FilterX size={13} />
                    Clear
                  </button>
                ) : null}
                <button type="button" className="biz-btn !px-2.5 text-xs" onClick={() => void exportCsv()} disabled={exporting}>
                  <Download size={13} />
                  {exporting ? "Exporting…" : "CSV"}
                </button>
              </div>
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
                placeholder="Code or name…  /"
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
            </div>
          </div>

          <div className="cu-ledger__body">
            {listQ.isLoading ? (
              <div className="biz-skeleton m-4 h-48 rounded-2xl" />
            ) : listQ.isError ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Gift}
                  tone="warning"
                  title="Vault not in this role"
                  reason="Membership coupons need club access. Plans and cashback still run."
                  href="/membership"
                  cta="Membership"
                />
              </div>
            ) : coupons.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={Gift}
                  title={filtersOn ? "No match" : "Vault is empty"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search or lane."
                      : "Issue the first code from this dock. Restrict it to the tiers that should get the cut."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {coupons.map((c) => {
                  const on = selectedId === c.id && !composing;
                  const key = statusKey(c.status);
                  const expired = isExpired(c);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false);
                          setSelectedId(on ? null : c.id);
                        }}
                        className={cn(
                          "cu-row cp-row",
                          on && "is-on",
                          key === "active" && !expired && "is-live",
                          key === "paused" && "is-paused",
                          expired && "is-expired",
                        )}
                      >
                        <span
                          className={cn(
                            "cu-avatar cp-avatar",
                            key === "active" && !expired && "is-live",
                            expired && "is-expired",
                          )}
                          aria-hidden
                        >
                          {initials(c.code)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 max-w-full truncate font-mono text-[0.95rem] font-semibold tracking-tight">
                              {c.code}
                            </p>
                            <StatusBadge status={key} />
                            {expired ? <StatusBadge status="expired" /> : null}
                          </div>
                          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{c.name}</span>
                            <span className="truncate">{plansLabel(c.planRestricted)}</span>
                            {c.expiresAt ? <span className="shrink-0">{formatDate(c.expiresAt)}</span> : null}
                          </p>
                        </div>
                        <div className="hidden min-w-0 shrink-0 text-right sm:block">
                          <p className="truncate text-[0.95rem] font-bold tabular-nums tracking-tight">
                            {c.discountPct != null ? `${c.discountPct}%` : "—"}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">
                            {formatNumber(c.redemptionCount)}
                            {c.maxRedemptions != null ? ` / ${formatNumber(c.maxRedemptions)}` : ""} used
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
            page={listQ.data?.page ?? page}
            total={listQ.data?.total ?? 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            isFetching={listQ.isFetching}
            className="cu-pager"
          />
        </div>

        <aside className={cn("cu-dock cu-panel", selected || composing ? "is-open" : "is-idle")}>
          {composing ? (
            <ComposeCoupon
              form={form}
              set={set}
              togglePlan={togglePlan}
              error={formError}
              saving={createMut.isPending}
              onClose={() => setComposing(false)}
              onSubmit={() => {
                if (!formValid(form)) {
                  setFormError("Code, name, and a 1–100% cut are required.");
                  return;
                }
                setFormError(null);
                createMut.mutate();
              }}
            />
          ) : selected ? (
            <InspectFile
              row={selected}
              copied={copied}
              toggling={statusMut.isPending}
              onCopy={() => void copyCode(selected.code)}
              onClose={() => setSelectedId(null)}
              onPause={() => setConfirmPause(selected)}
              onResume={() => statusMut.mutate({ id: selected.id, status: "ACTIVE" })}
            />
          ) : (
            <InspectIdle matching={listQ.data?.total ?? coupons.length} onCompose={startCompose} />
          )}
        </aside>
      </section>

      <section className="cu-floor cp-floor">
        <div className="cu-panel">
          <SectionHead
            icon={Sparkles}
            tone={conversion >= 20 && conversion < 80 ? "success" : conversion >= 80 ? "warning" : "cyan"}
            title="Redeem pulse"
            subtitle="Issued codes versus bookings that actually used one"
          />
          <div className="mb-pulse">
            <GlassRing3D
              value={conversion}
              label="Redeem"
              sub={`${formatNumber(redeemed)} of ${formatNumber(issued)}`}
              tone={conversion >= 80 ? "warning" : conversion > 0 ? "success" : "danger"}
            />
            <div className="mb-meters">
              <MeterBar label="Conversion" value={conversion} tone={conversion >= 80 ? "danger" : "success"} />
              <MeterBar label="Live share" value={pct(active, issued)} tone={active > 0 ? "success" : "danger"} />
              <MeterBar label="Take of booked" value={takeRate} tone={takeRate >= 25 ? "danger" : "accent"} />
            </div>
          </div>
          {revenueAfter > 0 ? (
            <p className="mt-3 min-w-0 truncate text-xs text-[var(--color-biz-muted)]">
              After cut {inr(revenueAfter, true)} · before {inr(revenueBefore, true)}
            </p>
          ) : null}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Crown} tone="warning" title="Plan mix" subtitle="Live codes by membership tier" />
          {mix.length > 0 ? (
            <IsoBarChart
              data={mix}
              format={(v) => formatNumber(v)}
              accent="amber"
              layout="bar"
              height={220}
              isLoading={analyticsQ.isLoading}
            />
          ) : analyticsQ.isError ? (
            <EmptyLane
              icon={Crown}
              tone="warning"
              title="Mix not in this role"
              reason="Plan buckets need coupon analytics access."
            />
          ) : (
            <EmptyLane
              icon={Crown}
              title="No mix yet"
              reason="Tier share appears once an active code is restricted — or left open to all plans."
            />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead icon={Users} tone="cyan" title="Club ops" subtitle="Plans, cashback, campaigns, bookings" />
          <div className="mb-ops">
            <Link href="/membership" className="mb-ops__row">
              <Icon3D icon={Crown} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Membership</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Tiers decide who may redeem a restricted code
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/membership/cashback" className="mb-ops__row">
              <Icon3D icon={Sparkles} tone="success" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Cashback</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Wallet credit after the job — beside this checkout cut
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/campaigns" className="mb-ops__row">
              <Icon3D icon={Ticket} tone="cyan" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Campaigns</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Broader promotions that can wrap a coupon
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/bookings" className="mb-ops__row">
              <Icon3D icon={Gift} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">Bookings</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-biz-muted)]">
                  Redemption fires when the member applies the code
                </p>
              </div>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmPause}
        title={`Pause ${confirmPause?.code ?? ""}?`}
        description="The next booking will not accept this code. Existing redemptions stay on the ledger."
        confirmLabel="Pause"
        destructive
        isLoading={statusMut.isPending}
        onClose={() => setConfirmPause(null)}
        onConfirm={() => {
          if (!confirmPause) return;
          statusMut.mutate({ id: confirmPause.id, status: "PAUSED" });
        }}
      />
    </div>
  );
}

function ComposeCoupon({
  form,
  set,
  togglePlan,
  error,
  saving,
  onClose,
  onSubmit,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  togglePlan: (tier: string) => void;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const copies = Number(form.copies) || 1;
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-start gap-4">
          <Icon3D icon={Plus} tone="warning" size="md" />
          <div className="min-w-0">
            <p className="cu-intel__label">Compose</p>
            <h2 className="mt-1.5 truncate text-lg font-bold tracking-tight">New coupon</h2>
            <p className="mt-1.5 text-sm text-[var(--color-biz-muted)]">
              Goes live as Active. Empty plan chips means every member can use it.
            </p>
          </div>
        </div>
        <button type="button" className="biz-btn !px-2.5" onClick={onClose} aria-label="Close form">
          <X size={14} />
        </button>
      </div>
      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="New coupon form">
        <label className="mb-field">
          <span>{copies > 1 ? "Prefix" : "Code"}</span>
          <input
            className="mb-input font-mono uppercase"
            value={form.code}
            onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder={copies > 1 ? "GOLD" : "GOLD20"}
          />
        </label>
        <label className="mb-field">
          <span>Name</span>
          <input className="mb-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Gold 20% club cut" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="mb-field">
            <span>Discount %</span>
            <input
              className="mb-input"
              type="number"
              min={1}
              max={100}
              value={form.discountPct}
              onChange={(e) => set("discountPct", e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <label className="mb-field">
            <span>Copies</span>
            <input
              className="mb-input"
              type="number"
              min={1}
              max={50}
              value={form.copies}
              onChange={(e) => set("copies", e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
          {copies === 1 ? (
            <>
              <label className="mb-field">
                <span>Max uses</span>
                <input
                  className="mb-input"
                  type="number"
                  min={1}
                  value={form.maxRedemptions}
                  onChange={(e) => set("maxRedemptions", e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Unlimited"
                />
              </label>
              <label className="mb-field">
                <span>Per member</span>
                <input
                  className="mb-input"
                  type="number"
                  min={1}
                  value={form.perUserLimit}
                  onChange={(e) => set("perUserLimit", e.target.value.replace(/[^\d]/g, ""))}
                />
              </label>
            </>
          ) : null}
        </div>
        {copies === 1 ? (
          <label className="mb-field">
            <span>Expires</span>
            <input className="mb-input" type="date" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
          </label>
        ) : null}
        <div className="mb-field">
          <span>Restricted to</span>
          <div className="cu-filter__row">
            {TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => togglePlan(tier)}
                className={cn("cu-chip capitalize", form.planRestricted.includes(tier) && "is-on")}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>
        {copies > 1 ? (
          <p className="text-xs leading-relaxed text-[var(--color-biz-muted)]">
            Issues {copies} codes as {form.code || "PREFIX"}0001… Server-side only — the client never invents a code.
          </p>
        ) : null}
        {error ? <p className="text-sm text-[var(--color-biz-danger)]">{error}</p> : null}
      </div>
      <div className="cu-dock__actions">
        <button
          type="button"
          className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
          disabled={!formValid(form) || saving}
          onClick={onSubmit}
        >
          {saving ? "Issuing…" : copies > 1 ? `Issue ${copies} codes` : "Issue coupon"}
        </button>
      </div>
    </div>
  );
}

function InspectFile({
  row,
  copied,
  toggling,
  onCopy,
  onClose,
  onPause,
  onResume,
}: {
  row: AdminMembershipCouponRow;
  copied: boolean;
  toggling: boolean;
  onCopy: () => void;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const key = statusKey(row.status);
  const expired = isExpired(row);
  const live = key === "active" && !expired;
  const cap = row.maxRedemptions;
  const usedPct = cap && cap > 0 ? pct(row.redemptionCount, cap) : 0;

  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("cu-avatar cu-avatar--lg cp-avatar", live && "is-live", expired && "is-expired")}>
            {initials(row.code)}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate font-mono text-lg font-bold tracking-tight">{row.code}</h2>
              <StatusBadge status={key} />
              {expired ? <StatusBadge status="expired" /> : null}
            </div>
            <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">{row.name}</p>
            <p className="mt-1 truncate text-xs text-[var(--color-biz-muted)]">{plansLabel(row.planRestricted)}</p>
          </div>
        </div>
        <button type="button" className="biz-btn !px-2.5" onClick={onClose} aria-label="Close file">
          <X size={14} />
        </button>
      </div>

      <div className="cu-dock__body" tabIndex={0} role="region" aria-label="Coupon details">
        <dl className="cu-dock__stats">
          <div className="cu-stat">
            <dt>Cut</dt>
            <dd>{row.discountPct != null ? `${row.discountPct}%` : "—"}</dd>
          </div>
          <div className="cu-stat">
            <dt>Redeemed</dt>
            <dd>
              {formatNumber(row.redemptionCount)}
              {cap != null ? ` / ${formatNumber(cap)}` : ""}
            </dd>
          </div>
          <div className="cu-stat">
            <dt>Per member</dt>
            <dd>{formatNumber(row.perUserLimit ?? 1)}</dd>
          </div>
          <div className="cu-stat">
            <dt>Expires</dt>
            <dd>{row.expiresAt ? formatDate(row.expiresAt) : "Open"}</dd>
          </div>
        </dl>

        {cap != null && cap > 0 ? <MeterBar label="Cap used" value={usedPct} tone={usedPct >= 90 ? "danger" : "accent"} /> : null}

        <div className="cb-note pq-note cp-note">
          <p className="cu-intel__label">What this code is</p>
          <p>
            {expired
              ? "The date has lapsed. Pause or archive it so checkout stops offering a dead cut."
              : live
                ? "Live on the next eligible booking. The engine validates the member's tier on the server — never from the client."
                : key === "paused"
                  ? "Paused. Checkout will reject this code until HQ resumes it."
                  : key === "draft"
                    ? "Still a draft. Members cannot see or apply it."
                    : "Archived. Keep it on the ledger; do not put it back on the shelf without a review."}
          </p>
        </div>
      </div>

      <div className="cu-dock__actions">
        <div className="flex min-w-0 flex-wrap gap-2">
          {live ? (
            <button type="button" className="biz-btn text-xs text-[var(--color-biz-danger)]" disabled={toggling} onClick={onPause}>
              <Pause size={13} />
              Pause
            </button>
          ) : key === "paused" || key === "draft" ? (
            <button type="button" className="biz-btn text-xs text-[var(--color-biz-success)]" disabled={toggling} onClick={onResume}>
              <Play size={13} />
              Resume
            </button>
          ) : null}
          <button type="button" className="biz-btn text-xs" onClick={onCopy}>
            <Copy size={13} />
            {copied ? "Copied" : "Copy code"}
          </button>
          <Link href="/membership" className="biz-btn text-xs">
            Plans
          </Link>
        </div>
        <p className="cu-inspect__hint">/ search · ↑↓ move · Esc closes</p>
      </div>
    </div>
  );
}
