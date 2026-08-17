"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  FilterX,
  IdCard,
  Landmark,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MeterBar, StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { useAdminProvidersQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminApi, type PendingPartnerDocument } from "@/services/admin-api";
import { formatDate, formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import { resolveApiBase } from "@/lib/api-base";
import { cn } from "@/lib/cn";

type SortKey = "oldest" | "newest";
type ConfirmAction = "approve" | "reject";

const JUMPS = [
  { href: "/hq/marketplace", label: "Marketplace HQ" },
  { href: "/vendors", label: "Partners" },
  { href: "/academy", label: "Academy" },
  { href: "/compliance", label: "Compliance" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  pan: "PAN",
  aadhar: "Aadhaar",
  aadhaar: "Aadhaar",
  bank_cheque: "Bank proof",
  gst: "GST",
  license: "License",
};

const PACK = ["pan", "aadhar", "bank_cheque"] as const;

function partnerLabel(doc: PendingPartnerDocument) {
  const u = doc.provider.user;
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return doc.provider.businessName || name || u.email || doc.provider.id.slice(0, 8);
}

function docTypeLabel(type: string) {
  return TYPE_LABELS[type.toLowerCase()] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function hoursInQueue(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return Number.isFinite(h) ? Math.max(0, h) : 0;
}

function queueAge(iso: string) {
  const h = hoursInQueue(iso);
  if (h < 1) return `${Math.max(1, Math.floor(h * 60))}m`;
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

function slaState(iso: string): "fresh" | "warm" | "stale" {
  const h = hoursInQueue(iso);
  if (h >= 48) return "stale";
  if (h >= 24) return "warm";
  return "fresh";
}

function fileUrl(doc: PendingPartnerDocument, apiBase: string) {
  return doc.documentUrl.startsWith("http") ? doc.documentUrl : `${apiBase}${doc.documentUrl}`;
}

function isImageDoc(doc: PendingPartnerDocument) {
  const fmt = (doc.fileFormat || doc.documentUrl.split(".").pop() || "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(fmt);
}

function fileMeta(doc: PendingPartnerDocument) {
  const fmt = (doc.fileFormat || doc.documentUrl.split(".").pop() || "file").toUpperCase();
  const size = doc.fileSize ? `${Math.max(1, Math.round(doc.fileSize / 1024))} KB` : null;
  return [fmt, size].filter(Boolean).join(" · ");
}

function expiringSoon(iso?: string | null) {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 && ms < 30 * 86_400_000;
}

function kycBrief(input: { count: number; stale: number; expiring: number; applications: number }) {
  const { count, stale, expiring, applications } = input;
  if (count === 0) {
    return {
      state: "stable" as const,
      label: "Clear",
      meaning: "No partner documents are waiting. The KYC queue is not the constraint.",
      impact: applications > 0 ? `${applications} applications can still move without a document pack.` : "Supply can expand as soon as the next upload lands.",
      action: applications > 0 ? "Open Partners and decide on applications that skipped documents." : "Keep the queue watched. New PAN, Aadhaar, and bank proofs land here.",
    };
  }
  if (stale > 0 || count >= 5) {
    return {
      state: "critical" as const,
      label: "Constrained",
      meaning:
        stale > 0
          ? `${stale} pack${stale === 1 ? "" : "s"} have sat over 48 hours. Partners cannot go live until HQ decides.`
          : `${count} documents are waiting. Supply cannot expand until this queue clears.`,
      impact: `${formatNumber(count)} in review · ${stale} stale · ${expiring} expiring within 30 days.`,
      action: "Inspect the oldest file first. Approve or reject with notes today.",
    };
  }
  if (count > 0 || expiring > 0) {
    return {
      state: "watch" as const,
      label: "Watch",
      meaning:
        expiring > 0
          ? `${expiring} document${expiring === 1 ? "" : "s"} expire within 30 days. Re-upload will be needed if they lapse.`
          : `${count} KYC pack${count === 1 ? "" : "s"} sit in the queue.`,
      impact: `${formatNumber(count)} pending · oldest is the SLA clock.`,
      action: "Work oldest-first. Reject incomplete scans so the partner can re-upload.",
    };
  }
  return {
    state: "stable" as const,
    label: "Clear",
    meaning: "Document Review is in range.",
    impact: "No KYC packs waiting.",
    action: "No document-queue action required.",
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
  icon: typeof FileText;
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
  { icon: IdCard, tone: "warning" as const, title: "Identity pack", copy: "PAN, Aadhaar, bank proof" },
  { icon: Clock, tone: "cyan" as const, title: "SLA", copy: "Oldest-first. 48h is stale" },
  { icon: ShieldCheck, tone: "success" as const, title: "Approve", copy: "Optional notes, full audit" },
  { icon: XCircle, tone: "danger" as const, title: "Reject", copy: "Reason required — partner re-uploads" },
];

function InspectIdle({ matching }: { matching: number }) {
  return (
    <div className="cu-inspect">
      <div className="cu-dock__head">
        <div className="flex min-w-0 items-center gap-4">
          <Icon3D icon={FileText} tone="warning" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">KYC file</h2>
              <span className="ops-alert-pill is-warm">Awaiting row</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Click a pack — or use ↑ ↓ — to preview, then approve or reject.
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
            <p className="cu-intel__label">Selected document</p>
            <p className="mt-1.5 text-base font-semibold tracking-tight">No file open</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-biz-muted)]">
              {matching > 0
                ? `${formatNumber(matching)} in queue · pick the oldest row on the left`
                : "The queue is clear — new uploads land on the left first"}
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

export default function VendorDocumentsPage() {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const apiBase = resolveApiBase();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    doc: PendingPartnerDocument;
    action: ConfirmAction;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["admin", "documents", "pending"],
    queryFn: () => adminApi.pendingDocuments(),
    refetchInterval: 60_000,
  });
  const applicationsQ = useAdminProvidersQuery({ page: 1, limit: 1, status: "applications", badge: true });

  const documents = queue.data?.documents ?? [];
  const types = useMemo(() => [...new Set(documents.map((d) => d.documentType))], [documents]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const rows = documents.filter((d) => {
      if (typeFilter !== "all" && d.documentType !== typeFilter) return false;
      if (!q) return true;
      const hay = `${partnerLabel(d)} ${d.documentType} ${d.documentName ?? ""} ${d.provider.user.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    rows.sort((a, b) => {
      const da = new Date(a.uploadedAt).getTime();
      const db = new Date(b.uploadedAt).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return rows;
  }, [debouncedSearch, documents, sort, typeFilter]);

  const selected = filtered.find((d) => d.id === selectedId) ?? null;
  const filtersOn = Boolean(debouncedSearch) || typeFilter !== "all" || sort !== "oldest";

  const detailQ = useQuery({
    queryKey: ["admin", "provider-detail", selected?.providerId],
    queryFn: () => adminApi.getProviderDetail(selected!.providerId),
    enabled: !!selected,
    staleTime: 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ providerId, docId, notes }: { providerId: string; docId: string; notes?: string }) =>
      adminApi.verifyPartnerDocument(providerId, docId, notes),
    onSuccess: () => {
      setActionError(null);
      setConfirmTarget(null);
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ["admin", "documents", "pending"] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { providerId: string; docId: string; reason: string }) =>
      adminApi.rejectPartnerDocument(vars.providerId, vars.docId, vars.reason),
    onSuccess: () => {
      setActionError(null);
      setConfirmTarget(null);
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ["admin", "documents", "pending"] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  useEffect(() => {
    if (selectedId && !filtered.some((d) => d.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

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
      if (typing || filtered.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedId ? filtered.findIndex((d) => d.id === selectedId) : -1;
      const next = e.key === "ArrowDown" ? Math.min(filtered.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelectedId(filtered[next]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedId]);

  const stale = documents.filter((d) => slaState(d.uploadedAt) === "stale").length;
  const warm = documents.filter((d) => slaState(d.uploadedAt) === "warm").length;
  const inSla = documents.filter((d) => slaState(d.uploadedAt) === "fresh").length;
  const slaPct = documents.length === 0 ? 100 : Math.round((inSla / documents.length) * 100);
  const expiring = documents.filter((d) => expiringSoon(d.expiryDate)).length;
  const applications = applicationsQ.data?.total ?? 0;
  const oldest = documents[0]
    ? documents.reduce((acc, d) => (new Date(d.uploadedAt) < new Date(acc.uploadedAt) ? d : acc), documents[0])
    : null;

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of documents) map.set(d.documentType, (map.get(d.documentType) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [documents]);

  const packCounts = PACK.map((id) => ({
    id,
    label: docTypeLabel(id),
    count: documents.filter((d) => d.documentType.toLowerCase() === id || (id === "aadhar" && d.documentType.toLowerCase() === "aadhaar")).length,
  }));

  const brief = kycBrief({ count: documents.length, stale, expiring, applications });
  const headerTone: Icon3DTone =
    brief.state === "critical" ? "danger" : brief.state === "watch" ? "warning" : "success";

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setSort("oldest");
  };

  const copyId = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const busy = verifyMutation.isPending || rejectMutation.isPending;
  const fetching = queue.isFetching || applicationsQ.isFetching;
  const preview = selected ? fileUrl(selected, apiBase) : "";
  const kyc = detailQ.data?.verification;

  return (
    <div className="exec-hq cu-page dr-page mx-auto min-w-0 max-w-[1600px] biz-page-enter">
      <header className={cn("cu-hero", `cu-hero--${brief.state}`)}>
        <div className="cu-hero__top">
          <div className="flex min-w-0 items-center gap-4">
            <Icon3D icon={FileText} tone={headerTone} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Document Review</h1>
                <span className="cmd-live-pill">
                  <span className="cmd-live-dot" aria-hidden />
                  KYC queue
                </span>
                <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                  {brief.label}
                </span>
              </div>
              <p className="cu-hero__lede">
                PAN, Aadhaar, and bank proofs for every homigo.com partner — inspect one pack at a time, oldest first.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void queue.refetch()} className="biz-btn shrink-0">
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
          label="Pending"
          value={formatNumber(documents.length)}
          sub={stale > 0 ? `${stale} older than 48h` : "waiting on HQ"}
          icon={ShieldAlert}
          loading={queue.isLoading}
          tone={stale > 0 || documents.length >= 5 ? "danger" : documents.length > 0 ? "accent" : "success"}
        />
        <StatTile
          label="Oldest"
          value={oldest ? queueAge(oldest.uploadedAt) : "—"}
          sub={oldest ? `in queue · ${docTypeLabel(oldest.documentType)}` : "nothing aging"}
          icon={Clock}
          loading={queue.isLoading}
          tone={oldest && slaState(oldest.uploadedAt) === "stale" ? "danger" : "default"}
        />
        <StatTile
          label="Expiring"
          value={formatNumber(expiring)}
          sub="within 30 days"
          icon={Clock}
          loading={queue.isLoading}
          tone={expiring > 0 ? "danger" : "success"}
        />
        <StatTile
          label="Applications"
          value={formatNumber(applications)}
          sub="partners still awaiting approval"
          icon={Sparkles}
          loading={applicationsQ.isLoading}
          tone={applications > 0 ? "accent" : "default"}
        />
      </section>

      {(stale > 0 || warm > 0 || expiring > 0 || applications > 0) && (
        <section className="cu-rail" aria-label="Attention">
          <p className="cu-rail__label">Now</p>
          {stale > 0 ? (
            <span className="cu-rail__chip is-hot">
              <ShieldAlert size={14} />
              {stale} stale
            </span>
          ) : null}
          {warm > 0 ? (
            <span className="cu-rail__chip is-warm">
              <Clock size={14} />
              {warm} over 24h
            </span>
          ) : null}
          {expiring > 0 ? (
            <span className="cu-rail__chip is-warm">
              <Clock size={14} />
              {expiring} expiring
            </span>
          ) : null}
          {applications > 0 ? (
            <Link href="/vendors" className="cu-rail__chip">
              <Wrench size={14} />
              {applications} applications
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
                <h2 className="text-sm font-semibold tracking-tight">Queue</h2>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  {queue.isLoading ? "Loading…" : `${formatNumber(filtered.length)} matching · oldest first is the SLA`}
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
                placeholder="Search partner, type, file…  /"
                className="cu-search"
              />
            </div>
            <div className="cu-toolbar__filters">
              <FilterGroup label="Type">
                <button type="button" onClick={() => setTypeFilter("all")} className={cn("cu-chip", typeFilter === "all" && "is-on")}>
                  all
                </button>
                {types.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={cn("cu-chip", typeFilter === t && "is-on")}
                  >
                    {docTypeLabel(t)}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Sort">
                <button type="button" onClick={() => setSort("oldest")} className={cn("cu-chip", sort === "oldest" && "is-on")}>
                  Oldest
                </button>
                <button type="button" onClick={() => setSort("newest")} className={cn("cu-chip", sort === "newest" && "is-on")}>
                  Newest
                </button>
              </FilterGroup>
            </div>
          </div>

          {actionError ? <div className="cu-alert">{actionError}</div> : null}

          <div className="cu-ledger__body">
            {queue.isFetching && !queue.isLoading ? <div className="cu-updating">Updating…</div> : null}

            {queue.isLoading ? (
              <div className="cu-list">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="biz-skeleton h-[4.75rem] rounded-2xl" />
                ))}
              </div>
            ) : queue.isError ? (
              <div className="cu-empty-wrap">
                <p className="text-sm">Could not load the KYC queue.</p>
                <button type="button" onClick={() => void queue.refetch()} className="biz-btn mt-4">
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="cu-empty-wrap">
                <EmptyLane
                  icon={ShieldCheck}
                  title={filtersOn ? "No match" : "Queue is clear"}
                  reason={
                    filtersOn
                      ? "Nothing matches the current search and filters."
                      : "PAN, Aadhaar, and bank proofs land here the moment a partner uploads."
                  }
                />
              </div>
            ) : (
              <ul className="cu-list">
                {filtered.map((doc) => {
                  const on = selectedId === doc.id;
                  const sla = slaState(doc.uploadedAt);
                  const name = partnerLabel(doc);
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(on ? null : doc.id)}
                        className={cn("cu-row dr-row", on && "is-on", sla === "stale" && "is-stale", sla === "warm" && "is-warm")}
                      >
                        <span className={cn("cu-avatar dr-avatar", sla === "stale" && "is-stale")} aria-hidden>
                          {initials(name)}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[0.95rem] font-semibold tracking-tight">{name}</p>
                            <span className="cu-chip is-on">{docTypeLabel(doc.documentType)}</span>
                            {expiringSoon(doc.expiryDate) ? (
                              <span className="cu-rail__chip is-warm !py-0.5 text-[10px]">Expiring</span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-xs leading-relaxed text-[var(--color-biz-muted)]">
                            <span className="truncate">{doc.documentName || docTypeLabel(doc.documentType)}</span>
                            {doc.provider.city ? <span>{doc.provider.city}</span> : null}
                            <span>{fileMeta(doc)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[0.95rem] font-bold tabular-nums tracking-tight">{queueAge(doc.uploadedAt)}</p>
                          <p className="mt-1 text-xs capitalize text-[var(--color-biz-muted)]">{sla === "fresh" ? "in SLA" : sla}</p>
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
            <div className="cu-inspect">
              <div className="cu-dock__head">
                <div className="flex min-w-0 items-start gap-4">
                  <span className={cn("cu-avatar cu-avatar--lg dr-avatar", slaState(selected.uploadedAt) === "stale" && "is-stale")}>
                    {initials(partnerLabel(selected))}
                  </span>
                  <div className="min-w-0">
                    <p className="cu-intel__label">KYC file</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold tracking-tight">{partnerLabel(selected)}</h2>
                      <span className={cn("ops-alert-pill", slaState(selected.uploadedAt) === "stale" ? "is-hot" : slaState(selected.uploadedAt) === "warm" ? "is-warm" : "is-good")}>
                        {slaState(selected.uploadedAt) === "fresh" ? "In SLA" : slaState(selected.uploadedAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm text-[var(--color-biz-muted)]">
                      {selected.provider.user.email ?? "—"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="cu-chip is-on">{docTypeLabel(selected.documentType)}</span>
                      {selected.provider.city ? <span className="cu-chip is-on">{selected.provider.city}</span> : null}
                      {selected.provider.isApproved ? <StatusBadge status="approved" /> : <StatusBadge status="pending" />}
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
                    <dt>In queue</dt>
                    <dd data-stat-value>{queueAge(selected.uploadedAt)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Uploaded</dt>
                    <dd>{formatDate(selected.uploadedAt)}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>Expiry</dt>
                    <dd>{selected.expiryDate ? formatDate(selected.expiryDate) : "—"}</dd>
                  </div>
                  <div className="cu-stat">
                    <dt>File</dt>
                    <dd>{fileMeta(selected)}</dd>
                  </div>
                </div>

                <div className="dr-preview">
                  {isImageDoc(selected) ? (
                    <img src={preview} alt={selected.documentName || docTypeLabel(selected.documentType)} />
                  ) : (
                    <div className="grid place-items-center gap-2 p-6 text-center">
                      <Icon3D icon={FileText} tone="warning" size="md" />
                      <p className="text-sm font-semibold">{selected.documentName || "Document"}</p>
                      <p className="text-xs text-[var(--color-biz-muted)]">{fileMeta(selected)}</p>
                    </div>
                  )}
                </div>

                <div className="cu-intel">
                  <p className="cu-intel__label">Partner OS</p>
                  {detailQ.isLoading ? (
                    <div className="biz-skeleton mt-4 h-24 rounded-xl" />
                  ) : (
                    <dl className="cu-intel__rows">
                      <div>
                        <dt>Partner KYC</dt>
                        <dd>{kyc?.isVerified ? "Verified" : "Open"}</dd>
                      </div>
                      <div>
                        <dt>Background</dt>
                        <dd>{kyc?.backgroundCheckStatus?.replace(/_/g, " ") ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Registration</dt>
                        <dd>{selected.provider.registrationStatus ?? "—"}</dd>
                      </div>
                    </dl>
                  )}
                  {selected.verificationNotes ? (
                    <p className="mt-3 text-xs leading-relaxed text-[var(--color-biz-warning)]">Note: {selected.verificationNotes}</p>
                  ) : null}
                </div>

                <div className="cu-jump-row">
                  <a href={preview} target="_blank" rel="noopener noreferrer" className="biz-btn text-xs">
                    <ExternalLink size={13} />
                    Open file
                  </a>
                  <Link href={`/vendors/${selected.providerId}`} className="biz-btn text-xs">
                    <IdCard size={13} />
                    Partner file
                  </Link>
                  <button type="button" className="biz-btn text-xs" onClick={() => void copyId(selected.id)}>
                    <Copy size={13} />
                    {copied ? "Copied" : "ID"}
                  </button>
                </div>
              </div>

              <div className="cu-dock__actions">
                <button
                  type="button"
                  className="biz-btn w-full justify-center text-[var(--color-biz-success)]"
                  disabled={busy}
                  onClick={() => setConfirmTarget({ doc: selected, action: "approve" })}
                >
                  <BadgeCheck size={14} />
                  Approve document
                </button>
                <button
                  type="button"
                  className="biz-btn w-full justify-center text-[var(--color-biz-danger)]"
                  disabled={busy}
                  onClick={() => setConfirmTarget({ doc: selected, action: "reject" })}
                >
                  <XCircle size={14} />
                  Reject — re-upload
                </button>
              </div>
            </div>
          ) : (
            <InspectIdle matching={filtered.length} />
          )}
        </aside>
      </section>

      <section className="cu-floor dr-floor">
        <div className="cu-panel">
          <SectionHead
            icon={ShieldCheck}
            tone={documents.length === 0 ? "success" : slaPct >= 70 ? "success" : "warning"}
            title="SLA"
            subtitle="Share of packs still inside 24 hours"
          />
          <div className="flex justify-center">
            <GlassRing3D
              value={slaPct}
              label="In SLA"
              sub={documents.length === 0 ? "Queue clear" : `${formatNumber(inSla)} of ${formatNumber(documents.length)} under 24h`}
              tone={slaPct >= 70 ? "success" : slaPct >= 40 ? "warning" : "danger"}
            />
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead icon={IdCard} tone="warning" title="Identity pack" subtitle="PAN · Aadhaar · bank proof in this queue" />
          <div className="space-y-3">
            {packCounts.map((p) => (
              <MeterBar
                key={p.id}
                label={p.label}
                value={p.count}
                max={Math.max(1, documents.length)}
                suffix=""
                tone={p.count > 0 ? "accent" : "success"}
              />
            ))}
          </div>
        </div>

        <div className="cu-panel">
          <SectionHead icon={FileText} tone="cyan" title="Types in queue" subtitle="What partners uploaded" />
          {typeCounts.length > 0 ? (
            <div>
              {typeCounts.map(([type, count]) => {
                const max = Math.max(1, ...typeCounts.map((x) => x[1]));
                return (
                  <button type="button" key={type} className="dr-type w-full text-left" onClick={() => setTypeFilter(type)}>
                    <span className="w-24 shrink-0 truncate text-sm font-semibold">{docTypeLabel(type)}</span>
                    <div className="dr-type__bar" aria-hidden>
                      <span style={{ width: `${Math.max(8, (count / max) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs font-bold tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyLane icon={FileText} tone="cyan" title="No types yet" reason="Document types appear when the first upload lands." />
          )}
        </div>

        <div className="cu-panel">
          <SectionHead
            icon={Landmark}
            tone="success"
            title="Applications"
            subtitle="Partners waiting on HQ, with or without a pack"
            action={
              <Link href="/vendors" className="text-[11px] font-semibold text-[var(--color-biz-accent)]">
                Roster
              </Link>
            }
          />
          {applications > 0 ? (
            <EmptyLane
              icon={Sparkles}
              tone="warning"
              title={`${formatNumber(applications)} application${applications === 1 ? "" : "s"}`}
              reason="Some partners skip documents at registration. Decide those from the partner roster."
              href="/vendors"
              cta="Open Partners"
            />
          ) : (
            <EmptyLane icon={Wrench} tone="success" title="No open applications" reason="New self-registrations land on the partner roster." href="/vendors" cta="Partners" />
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTarget?.action === "approve" ? "Approve this document?" : "Reject document?"}
        description={
          confirmTarget
            ? confirmTarget.action === "approve"
              ? `${docTypeLabel(confirmTarget.doc.documentType)} for ${partnerLabel(confirmTarget.doc)} will be marked verified.`
              : `${partnerLabel(confirmTarget.doc)} will need to re-upload. The reason is stored on the file.`
            : undefined
        }
        confirmLabel={confirmTarget?.action === "approve" ? "Approve document" : "Reject document"}
        destructive={confirmTarget?.action === "reject"}
        reasonLabel={confirmTarget?.action === "approve" ? "Notes (optional)" : "Rejection reason"}
        reasonRequired={confirmTarget?.action === "reject"}
        reasonPlaceholder={
          confirmTarget?.action === "approve" ? "e.g. Match with PAN, photo clear" : "Explain what needs to be corrected…"
        }
        isLoading={busy}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (reason) => {
          if (!confirmTarget) return;
          setActionError(null);
          if (confirmTarget.action === "reject") {
            if (!reason?.trim()) {
              setActionError("Please enter a rejection reason.");
              return;
            }
            await rejectMutation.mutateAsync({
              providerId: confirmTarget.doc.providerId,
              docId: confirmTarget.doc.id,
              reason: reason.trim(),
            });
            return;
          }
          await verifyMutation.mutateAsync({
            providerId: confirmTarget.doc.providerId,
            docId: confirmTarget.doc.id,
            notes: reason?.trim() || undefined,
          });
        }}
      />
    </div>
  );
}
