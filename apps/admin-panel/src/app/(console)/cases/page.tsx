"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminApi, ADMIN_CASE_STATES, ADMIN_CASE_TYPES } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";

const PAGE_SIZE = 50;

/** Phase 10 §11 — complaint / warranty-claim case queue (DISPUTES resource). */
export default function CasesQueuePage() {
  const [state, setState] = useState("");
  const [type, setType] = useState("");
  const [slaBreached, setSlaBreached] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "cases", state, type, slaBreached, page],
    queryFn: () =>
      adminApi.cases.list({
        state: state || undefined,
        type: type || undefined,
        slaBreached: slaBreached || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 10_000,
    retry: 1,
  });

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = (data?.cases ?? []).map((c) => [
    <Link key={"c-" + c.id} href={"/cases/" + c.id} className="font-mono text-xs underline">{c.caseNumber}</Link>,
    <Link key={"b-" + c.id} href={"/bookings/" + c.bookingId} className="text-xs underline">{c.bookingId.slice(0, 12)}…</Link>,
    c.type.replace(/_/g, " "),
    c.category.replace(/_/g, " ").toLowerCase(),
    <StatusBadge key={"s-" + c.id} status={c.state} />,
    c.slaBreached ? (
      <span key={"sla-" + c.id} className="text-xs font-semibold text-red-400">breached{c.slaDueAt ? " · due " + new Date(c.slaDueAt).toLocaleString() : ""}</span>
    ) : c.slaDueAt ? (
      "due " + new Date(c.slaDueAt).toLocaleString()
    ) : (
      "—"
    ),
    new Date(c.createdAt).toLocaleString(),
    <Link key={"v-" + c.id} href={"/cases/" + c.id} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Open case " + c.caseNumber}>
      Open
    </Link>,
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-[var(--color-biz-accent)]" /> Cases
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Complaints and warranty claims reported on completed bookings. Triage within the SLA, then decide.
          </p>
        </div>
      </div>

      <div className="biz-card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-[var(--color-biz-muted)]">
          State
          <select
            value={state}
            onChange={(e) => { setState(e.target.value); setPage(0); }}
            className="mt-1 block rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-2 py-1.5 text-sm text-[var(--color-biz-text)]"
          >
            <option value="">All states</option>
            {ADMIN_CASE_STATES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-biz-muted)]">
          Type
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(0); }}
            className="mt-1 block rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-2 py-1.5 text-sm text-[var(--color-biz-text)]"
          >
            <option value="">All types</option>
            {ADMIN_CASE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-[var(--color-biz-muted)]">
          <input
            type="checkbox"
            checked={slaBreached}
            onChange={(e) => { setSlaBreached(e.target.checked); setPage(0); }}
            className="h-3.5 w-3.5"
          />
          SLA breached only
        </label>
        <span className="ml-auto pb-1.5 text-xs text-[var(--color-biz-muted)]">{total} case{total === 1 ? "" : "s"}</span>
      </div>

      <DataTable
        title="Case queue"
        headers={["Case", "Booking", "Type", "Category", "State", "SLA", "Created", "Action"]}
        rows={rows}
        loading={isLoading}
        isError={isError}
        errorMessage={isError ? getErrorMessage(error, "Could not load cases") : undefined}
        onRetry={() => void refetch()}
        emptyMessage={data && !data.available ? "Cases are not deployed on this database" : "No cases match these filters"}
      />

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            aria-label="Previous page of cases"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--color-biz-muted)]">Page {page + 1} of {pageCount}</span>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            aria-label="Next page of cases"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
