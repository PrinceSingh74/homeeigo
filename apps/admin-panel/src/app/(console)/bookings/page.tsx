"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, RotateCcw, Search, Star } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Pagination } from "@/components/ui/Pagination";
import { useAdminBookingsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatNumber, inr } from "@/lib/format";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  "all", "pending", "accepted", "assigned", "en_route", "in_progress",
  "completed", "cancelled_by_user", "cancelled_by_provider",
] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

function emptyToUndef(s: string): string | undefined {
  return s.trim() === "" ? undefined : s.trim();
}

export default function BookingsPage() {
  const dashboard = useAdminDashboardQuery();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusOption>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : "",
  );
  const search = useDebouncedValue(searchInput, 300);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      status,
      search: emptyToUndef(search),
      startDate: emptyToUndef(startDate),
      endDate: emptyToUndef(endDate),
    }),
    [endDate, page, search, startDate, status],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminBookingsQuery(params);

  const rows = useMemo(
    () =>
      (data?.bookings ?? []).map((b) => [
        <Link key={`id-${b.id}`} href={`/bookings/${b.id}`} className="font-mono text-xs text-[var(--color-biz-accent)] hover:underline">
          {b.bookingNumber ?? b.id.slice(0, 8)}
        </Link>,
        b.user,
        b.provider,
        b.service,
        inr(b.amount),
        <StatusBadge key={`st-${b.id}`} status={b.status} />,
        b.rating ? (
          <span key={`r-${b.id}`} className="flex items-center gap-1 text-xs">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {Number(b.rating).toFixed(1)}
          </span>
        ) : "—",
        <span key={`c-${b.id}`} className="text-xs text-[var(--color-biz-muted)]">{formatDate(b.completedAt)}</span>,
      ]),
    [data?.bookings],
  );

  function resetFilters() {
    setStatus("all");
    setStartDate("");
    setEndDate("");
    setSearchInput("");
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bookings</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Operations console — search, drill down, take action</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total bookings" value={dashboard.isLoading ? "—" : formatNumber(dashboard.data?.stats.totalBookings ?? 0)} icon={CalendarCheck} />
        <KpiCard label="Completed" value={dashboard.isLoading ? "—" : formatNumber(dashboard.data?.stats.completedBookings ?? 0)} icon={CalendarCheck} accent="green" />
        <KpiCard label="Matching filter" value={formatNumber(data?.total ?? 0)} icon={CalendarCheck} />
      </div>

      <div className="biz-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">Search</label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-biz-muted)]" />
            <input
              value={searchInput}
              onChange={(e) => { setPage(1); setSearchInput(e.target.value); }}
              placeholder="Booking #, ID, customer…"
              className="w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
            />
          </div>
        </div>
        <div className="min-w-[180px]">
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">Status</label>
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as StatusOption); }} className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 px-3 text-sm capitalize outline-none">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">From</label>
          <input type="date" value={startDate} onChange={(e) => { setPage(1); setStartDate(e.target.value); }} className="mt-1 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 px-3 text-sm outline-none" />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">To</label>
          <input type="date" value={endDate} onChange={(e) => { setPage(1); setEndDate(e.target.value); }} className="mt-1 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 px-3 text-sm outline-none" />
        </div>
        <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1.5 self-end rounded-lg border border-[var(--color-biz-line)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-biz-elevated)]">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <DataTable
        headers={["Booking", "Customer", "Vendor", "Service", "Amount", "Status", "Rating", "Completed"]}
        isLoading={isLoading}
        isFetching={isFetching && !data}
        isError={isError}
        onRetry={() => void refetch()}
        emptyMessage="No bookings match the current filters."
        rows={rows}
        footer={<Pagination page={data?.page ?? page} total={data?.total ?? 0} limit={PAGE_SIZE} onPageChange={setPage} isFetching={isFetching} />}
      />
    </div>
  );
}
