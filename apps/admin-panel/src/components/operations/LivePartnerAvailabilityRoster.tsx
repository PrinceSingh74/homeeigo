"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi } from "@/services/admin-api";

const STATUSES = ["", "online", "offline", "paused", "suspended", "available", "on_job", "en_route"];

export function LivePartnerAvailabilityRoster() {
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
    p.status.replace(/_/g, " "),
    p.city || p.zones.slice(0, 2).join(", ") || "—",
    p.skills.slice(0, 2).join(", ") || "—",
    `${p.currentJobs}/${p.maxConcurrent}`,
    `${p.utilization}%`,
    p.lastSeen ? new Date(p.lastSeen).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—",
    p.nextAvailable
      ? new Date(p.nextAvailable).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : "—",
  ]);

  return (
    <section className="space-y-4">
      <SectionHead
        icon={Radio}
        tone="success"
        title="Live partner availability"
        subtitle="Status, zone, capacity, and utilization — dispatch eligibility comes from the same engine"
        meta={`${roster.data?.total ?? 0} partners`}
      />
      <div className="biz-glass-panel flex flex-wrap gap-2 p-3">
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
              {s ? s.replace(/_/g, " ") : "All statuses"}
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
        headers={["Partner", "Status", "Zone", "Skills", "Jobs", "Util", "Last seen", "Next"]}
        rows={rows}
        isLoading={roster.isLoading}
        isError={roster.isError}
        emptyMessage="No partners match these filters."
        onRetry={() => void roster.refetch()}
      />
    </section>
  );
}
