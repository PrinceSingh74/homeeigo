"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi } from "@/services/admin-api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export default function ObservabilityLogsPage() {
  const [search, setSearch] = useState("");
  const [requestId, setRequestId] = useState("");
  const [level, setLevel] = useState("");
  const qSearch = useDebouncedValue(search.trim(), 250);
  const qRequest = useDebouncedValue(requestId.trim(), 250);

  const logs = useQuery({
    queryKey: ["admin", "observability", "logs", qSearch, qRequest, level],
    queryFn: () =>
      adminApi.observability.logs({
        search: qSearch || undefined,
        requestId: qRequest || undefined,
        level: level || undefined,
        limit: 50,
      }),
    staleTime: 15_000,
  });

  const rows = useMemo(
    () =>
      (logs.data?.logs ?? []).map((row) => [
        new Date(row.createdAt).toLocaleString(),
        row.level,
        row.category,
        row.message.slice(0, 120),
        row.requestId ?? "—",
        row.traceId?.slice(0, 12) ?? "—",
        row.bookingId?.slice(0, 8) ?? "—",
      ]),
    [logs.data],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <SectionHead
        icon={FileText}
        tone="cyan"
        title="Log Search"
        subtitle="Request ID, trace, booking, and message — AUDIT_LOGS:READ. Secrets are redacted at write time."
      />
      <div className="biz-glass-panel flex flex-wrap gap-2 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message"
          aria-label="Search log message"
          className="min-h-11 min-w-[160px] flex-1 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
        />
        <input
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="Request / correlation ID"
          aria-label="Filter by request ID"
          className="min-h-11 min-w-[180px] rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label="Filter level"
          className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm"
        >
          <option value="">All levels</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
        </select>
      </div>
      {logs.isError ? (
        <div className="biz-glass-panel p-4" role="alert">
          <p className="text-sm">Log search failed. This role may not hold AUDIT_LOGS:READ.</p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void logs.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <DataTable
          title="Recent logs"
          columns={["Time", "Level", "Category", "Message", "Request ID", "Trace", "Booking"]}
          rows={rows}
          loading={logs.isLoading}
          emptyMessage={qSearch || qRequest ? "No logs match these filters." : "No logs in the current window."}
        />
      )}
    </div>
  );
}
