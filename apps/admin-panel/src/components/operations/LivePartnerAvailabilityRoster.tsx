"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi } from "@/services/admin-api";

const STATUSES = ["", "online", "offline", "paused", "available", "offered", "accepting", "en_route", "on_job", "account_restricted"];

function formatPresence(value: "FRESH" | "STALE" | "EXPIRED" | undefined): string {
  if (value === "FRESH") return "Live";
  if (value === "STALE") return "Stale";
  if (value === "EXPIRED") return "Expired";
  return "—";
}

function formatBlock(code: string | null | undefined): string {
  if (!code) return "Not eligible";
  return `Not eligible · ${code.replace(/_/g, " ").toLowerCase()}`;
}

export function LivePartnerAvailabilityRoster({ heading = true }: { heading?: boolean }) {
  const [status, setStatus] = useState("");
  const [capacity, setCapacity] = useState("");
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState("");

  const roster = useQuery({
    queryKey: ["admin", "partner-availability", status, capacity, search, zone],
    queryFn: () =>
      adminApi.partnerAvailability({
        status: status || undefined,
        capacity: capacity === "full" || capacity === "available" ? capacity : undefined,
        search: search || undefined,
        zone: zone || undefined,
        limit: 50,
      }),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const rows = (roster.data?.items ?? []).map((p) => [
    p.name,
    (p.lifecycleState ?? "—").replace(/_/g, " "),
    p.status.replace(/_/g, " "),
    formatPresence(p.presence),
    formatPresence(p.locationFreshness),
    p.dispatchEligible ? "Eligible" : formatBlock(p.dispatchBlockedBy),
    p.lastSeen ? new Date(p.lastSeen).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—",
    `${p.currentJobs}/${p.maxConcurrent}`,
  ]);

  return (
    <section className="space-y-5">
      {heading ? (
        <SectionHead
          icon={Radio}
          tone="success"
          title="Live partner availability"
          subtitle="Lifecycle, availability, presence, and dispatch eligibility stay in their own columns"
          meta={`${roster.data?.total ?? 0} partners`}
        />
      ) : null}
      <div className="biz-glass-panel flex flex-wrap items-center gap-3 p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search partner or city"
          className="min-h-11 min-w-[180px] flex-1 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
          aria-label="Search partners"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
          aria-label="Filter status"
        >
          {STATUSES.map((s) => (
            <option key={s || "all"} value={s}>
              {s === "account_restricted" ? "Account restricted" : s ? s.replace(/_/g, " ") : "All statuses"}
            </option>
          ))}
        </select>
        <select
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
          aria-label="Filter capacity"
        >
          <option value="">All capacity</option>
          <option value="available">Slots available</option>
          <option value="full">Capacity full</option>
        </select>
        <input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="Zone"
          className="min-h-11 w-[140px] rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
          aria-label="Filter zone"
        />
      </div>
      <DataTable
        title={heading ? undefined : "Live roster"}
        hint={
          heading
            ? undefined
            : "Lifecycle, availability, presence, and dispatch stay in their own columns — never one enum"
        }
        icon={heading ? undefined : Radio}
        iconTone="success"
        headers={["Partner", "Lifecycle", "Availability", "Presence", "Location", "Dispatch", "Last seen", "Jobs"]}
        rows={rows}
        isLoading={roster.isLoading}
        isError={roster.isError}
        emptyMessage="No partners match these filters."
        emptyDescription="Try clearing the status or zone filter. Empty here means no matching rows — not a failed request."
        onRetry={() => void roster.refetch()}
        footer={
          heading ? undefined : (
            <p className="px-4 py-3 text-xs text-[var(--color-biz-muted)]">
              {roster.data?.total ?? 0} partners in this view
            </p>
          )
        }
      />
    </section>
  );
}
