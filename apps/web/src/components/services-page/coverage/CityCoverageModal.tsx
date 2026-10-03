"use client";

import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  Activity,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Users,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useCityCoverage } from "@/hooks/use-coverage";
import {
  COVERAGE_STATUS_LABEL,
  DENSITY_LABEL,
  type AreaCoverage,
  type CityCoverageDetail,
  type CoverageStatus,
  type PincodeCoverage,
  type ServiceAvailability,
  type SocietyCoverage,
} from "@/lib/coverage/coverage-types";
import { RequestCoverageForm } from "./RequestCoverageForm";

type Props = {
  citySlug: string | null;
  cityName?: string;
  onClose: () => void;
};

type TabId = "overview" | "areas" | "pincodes" | "societies" | "services";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "areas", label: "Areas" },
  { id: "pincodes", label: "Pincodes" },
  { id: "societies", label: "Societies" },
  { id: "services", label: "Services" },
];

const nf = new Intl.NumberFormat("en-IN");

function statusTone(status: CoverageStatus): string {
  return status === "AVAILABLE"
    ? "bg-emerald-100 text-emerald-700"
    : status === "LIMITED"
      ? "bg-amber-100 text-amber-700"
      : "bg-gray-200 text-gray-600";
}

function StatusBadge({ status }: { status: CoverageStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(status)}`}>
      {COVERAGE_STATUS_LABEL[status]}
    </span>
  );
}

/* ── Level 1: City overview + Level 6 density + Level 7 response engine ── */

const OverviewTab = memo(function OverviewTab({ detail }: { detail: CityCoverageDetail }) {
  const s = detail.summary;
  /**
   * Only measured figures appear.
   *
   * These read a seeded baseline whenever the real aggregate was zero, so a city with no partners
   * and no completed bookings still advertised "250+ verified partners" and "70,389+ services
   * completed". The backend now sends the measured value or null, and null is omitted rather than
   * printed as "null+".
   */
  const stats = [
    ...(s.customers != null ? [{ label: "Customers", value: `${nf.format(s.customers)}+`, icon: Users }] : []),
    ...(s.servicesCompleted != null
      ? [{ label: "Services Completed", value: `${nf.format(s.servicesCompleted)}+`, icon: CalendarCheck }]
      : []),
    ...(s.activePartners != null
      ? [{ label: "Verified Partners", value: `${nf.format(s.activePartners)}+`, icon: ShieldCheck }]
      : []),
    ...(s.fulfillmentRate != null
      ? [{ label: "Service Fulfillment", value: `${s.fulfillmentRate}%`, icon: ThumbsUp }]
      : []),
  ];
  const engine = detail.responseEngine;
  /**
   * Booking Acceptance appears only when it has been measured.
   *
   * It used to be `seeded(91, 98)` on the backend — a number with no connection to any dispatch that
   * ever happened, shown to customers as a fact. It is now measured from real dispatch outcomes and
   * arrives as null for a city with no history. A metric we cannot measure is omitted rather than
   * invented, which is the same rule the rest of the product follows for unbacked features.
   */
  /**
   * Every operational figure here is measured or omitted.
   *
   * All four were `seeded()` on the backend — deterministic numbers with no connection to any
   * booking or dispatch, shown to customers as facts. They are now measured from real data and
   * arrive as null when a city has nothing to measure, and a metric we cannot measure is left out
   * rather than invented.
   */
  const engineStats = [
    ...(engine.avgArrivalMins != null
      ? [{ label: "Avg Arrival Time", value: `${engine.avgArrivalMins} mins`, icon: Clock }]
      : []),
    ...(engine.acceptanceRate != null
      ? [{ label: "Booking Acceptance", value: `${engine.acceptanceRate}%`, icon: CheckCircle2 }]
      : []),
    ...(engine.completionRate != null
      ? [{ label: "Completion Rate", value: `${engine.completionRate}%`, icon: Activity }]
      : []),
    ...(engine.cancellationRate != null
      ? [{ label: "Cancellation Rate", value: `${engine.cancellationRate}%`, icon: XCircle }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {stats.map((st) => (
          <div key={st.label} className="rounded-2xl border border-line bg-white/70 p-3.5">
            <st.icon size={16} className="text-emerald-600" />
            <p className="svc-num mt-2 text-xl font-bold text-content">{st.value}</p>
            <p className="text-xs text-muted">{st.label}</p>
          </div>
        ))}
      </div>

      <section>
        {/*
          Availability, not density.
          This drew a "Live Partner Density" bar whose width and HIGH/MEDIUM/LOW band came from a
          seeded hash of the area name — no partner is attributed below city level, so there was
          never a density to show. Each area's declared status is real editorial data, so the
          section now reports that instead of inventing a number to fill the bar.
        */}
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-content">
          <Flame size={14} className="text-orange-500" /> Area Availability
        </h3>
        <div className="space-y-1.5">
          {detail.areas.map((a) => (
            <div key={a.id} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-xs font-medium text-muted sm:w-40">{a.name}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span
                  className={`block h-full rounded-full ${
                    a.status === "AVAILABLE" ? "bg-emerald-500" : a.status === "LIMITED" ? "bg-amber-400" : "bg-gray-300"
                  }`}
                  style={{ width: a.status === "AVAILABLE" ? "100%" : a.status === "LIMITED" ? "55%" : "12%" }}
                />
              </span>
              <span className="w-20 shrink-0 text-right text-[11px] font-semibold text-muted">
                {a.status === "AVAILABLE" ? "Available" : a.status === "LIMITED" ? "Limited" : "Soon"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" /> High Availability</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400" /> Medium Availability</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-gray-300" /> Low Availability</span>
        </p>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-content">
          <Sparkles size={14} className="text-emerald-600" /> Service Response Engine
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {engineStats.map((st) => (
            <div key={st.label} className="rounded-xl border border-line bg-white/70 p-3 text-center">
              <st.icon size={14} className="mx-auto text-emerald-600" />
              <p className="svc-num mt-1.5 text-sm font-bold text-content">{st.value}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted">{st.label}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
});

/* ── Level 2: Areas ── */

const AreaCard = memo(function AreaCard({ area, cityName }: { area: AreaCoverage; cityName: string }) {
  const [showRequest, setShowRequest] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-white/70 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-content">
            <span className="truncate">{area.name}</span>
            <StatusBadge status={area.status} />
          </p>
          <p className="mt-1 text-xs text-muted">
            {area.societyCount} societies · {area.pincodes.join(", ")}
          </p>
        </div>
      </div>
      {area.status !== "COMING_SOON" ? (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {area.activePartners != null && (
            <span className="flex items-center gap-1 font-medium text-emerald-700">
              <Users size={11} /> {area.activePartners} partners
            </span>
          )}
          {area.avgArrivalMins != null && (
            <span className="flex items-center gap-1">
              <Clock size={11} /> ~{area.avgArrivalMins} mins arrival
            </span>
          )}
          {area.density != null && (
            <span className="flex items-center gap-1">
              <Flame size={11} /> {DENSITY_LABEL[area.density]}
            </span>
          )}
        </p>
      ) : showRequest ? (
        <div className="mt-3">
          <RequestCoverageForm defaultCity={cityName} defaultArea={area.name} onDone={() => setShowRequest(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowRequest(true)}
          className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-600"
        >
          Request Coverage
        </button>
      )}
    </div>
  );
});

/* ── Level 3: Pincodes ── */

const PincodeGrid = memo(function PincodeGrid({ pincodes }: { pincodes: PincodeCoverage[] }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {pincodes.map((p) => (
          <div key={p.pincode} className="rounded-xl border border-line bg-white/70 p-3">
            <p className="svc-num text-sm font-bold text-content">{p.pincode}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted">{p.areaName}</p>
            <div className="mt-1.5 flex items-center justify-between gap-1">
              <StatusBadge status={p.status} />
              {p.status !== "COMING_SOON" && p.partnerCount != null && (
                <span className="text-[10px] font-medium text-muted">{p.partnerCount} pros</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Don&apos;t see your pincode? Use the coverage search to request it.
      </p>
    </div>
  );
});

/* ── Level 4: Societies (windowed list — scales to thousands of rows) ── */

const SOCIETY_ROW_H = 92;
const SOCIETY_VIEWPORT_H = 380;
const OVERSCAN = 4;

const SocietyRow = memo(function SocietyRow({ society }: { society: SocietyCoverage }) {
  return (
    <div className="flex h-[84px] flex-col justify-center rounded-2xl border border-line bg-white/70 px-3.5">
      <p className="flex items-center gap-2 text-sm font-bold text-content">
        <Building2 size={13} className="shrink-0 text-emerald-600" />
        <span className="truncate">{society.name}</span>
        <StatusBadge status={society.status} />
      </p>
      {society.status !== "COMING_SOON" ? (
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {/* A seeded star rating on a trust surface was the worst of these — omitted, not invented. */}
          {society.partnerCount != null && (
            <span className="flex items-center gap-1"><Users size={11} /> {society.partnerCount} partners</span>
          )}
          {society.avgResponseMins != null && (
            <span className="flex items-center gap-1"><Clock size={11} /> ~{society.avgResponseMins} mins</span>
          )}
          {society.rating != null && (
            <span className="flex items-center gap-1"><Star size={11} className="text-amber-500" /> {society.rating}</span>
          )}
          <span className="hidden items-center gap-1 sm:flex">
            <CheckCircle2 size={11} className="text-emerald-600" /> {society.availableServices.length} services
          </span>
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] font-medium text-amber-600">{society.areaName} — launching soon</p>
      )}
    </div>
  );
});

const SocietiesTab = memo(function SocietiesTab({ societies }: { societies: SocietyCoverage[] }) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = deferredFilter.trim().toLowerCase();
    if (!q) return societies;
    return societies.filter((s) => s.name.toLowerCase().includes(q) || s.areaName.toLowerCase().includes(q));
  }, [societies, deferredFilter]);

  const onScroll = useCallback(() => {
    if (viewportRef.current) setScrollTop(viewportRef.current.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / SOCIETY_ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(SOCIETY_VIEWPORT_H / SOCIETY_ROW_H) + OVERSCAN * 2;
  const end = Math.min(filtered.length, start + visibleCount);
  const slice = filtered.slice(start, end);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-white/70 px-3 py-2">
        <Search size={14} className="shrink-0 text-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search ${societies.length} societies…`}
          className="w-full bg-transparent text-sm text-content outline-none placeholder:text-muted"
          aria-label="Filter societies"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No societies match — try the coverage search to request yours.
        </p>
      ) : (
        <div
          ref={viewportRef}
          onScroll={onScroll}
          style={{ height: Math.min(SOCIETY_VIEWPORT_H, filtered.length * SOCIETY_ROW_H) }}
          className="overflow-y-auto pr-1"
        >
          <div style={{ height: filtered.length * SOCIETY_ROW_H, position: "relative" }}>
            <div style={{ position: "absolute", top: start * SOCIETY_ROW_H, left: 0, right: 0 }}>
              {slice.map((s) => (
                <div key={s.id} style={{ height: SOCIETY_ROW_H }} className="pb-2">
                  <SocietyRow society={s} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/* ── Level 5: Services availability ── */

const ServicesTab = memo(function ServicesTab({ services }: { services: ServiceAvailability[] }) {
  return (
    <div className="space-y-2">
      {services.map((svc) => (
        <div
          key={svc.slug}
          className="flex items-center justify-between rounded-xl border border-line bg-white/70 px-3.5 py-2.5"
        >
          <span className="text-sm font-semibold text-content">{svc.name}</span>
          {svc.availability === "TODAY" ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 size={12} /> Available Today
            </span>
          ) : svc.availability === "TOMORROW" ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              <Clock size={12} /> Tomorrow
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-1 text-[11px] font-bold text-gray-500">
              <XCircle size={12} /> Not Available
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

/* ── Modal shell ── */

export function CityCoverageModal({ citySlug, cityName, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("overview");
  const { data: detail, isLoading, isError, refetch } = useCityCoverage(citySlug);

  const title = detail ? `${detail.summary.name} Service Coverage` : cityName ? `${cityName} Service Coverage` : "Service Coverage";

  return (
    <Modal open={Boolean(citySlug)} onClose={onClose} title={title} size="lg" className="sm:max-w-3xl">
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted">
          <Loader2 size={18} className="animate-spin" /> Checking hyperlocal coverage…
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <MapPin size={28} className="text-muted" />
          <p className="text-sm text-muted">Couldn&apos;t load coverage right now.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Try again
          </button>
        </div>
      )}

      {detail && (
        <div>
          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Coverage levels">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  tab === t.id
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t.label}
                {t.id === "areas" && ` (${detail.areas.length})`}
                {t.id === "pincodes" && ` (${detail.pincodes.length})`}
                {t.id === "societies" && ` (${detail.societies.length})`}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab detail={detail} />}
          {tab === "areas" && (
            <div className="space-y-2.5">
              {detail.areas.map((a) => (
                <AreaCard key={a.id} area={a} cityName={detail.summary.name} />
              ))}
            </div>
          )}
          {tab === "pincodes" && <PincodeGrid pincodes={detail.pincodes} />}
          {tab === "societies" && <SocietiesTab societies={detail.societies} />}
          {tab === "services" && <ServicesTab services={detail.services} />}
        </div>
      )}
    </Modal>
  );
}
