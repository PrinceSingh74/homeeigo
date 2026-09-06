"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi } from "@/services/admin-api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

function AuditExplorerInner() {
  const params = useSearchParams();
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [resource, setResource] = useState("");
  const [entity, setEntity] = useState(params.get("resourceId") ?? "");
  const [trace, setTrace] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();

  const qAction = useDebouncedValue(action.trim(), 250);
  const qActor = useDebouncedValue(actor.trim(), 250);
  const qResource = useDebouncedValue(resource.trim(), 250);
  const qEntity = useDebouncedValue(entity.trim(), 250);
  const qTrace = useDebouncedValue(trace.trim(), 250);

  const audit = useQuery({
    queryKey: ["admin", "audit", qAction, qActor, qResource, qEntity, qTrace, status, cursor],
    queryFn: () =>
      adminApi.auditLogs({
        action: qAction || undefined,
        actor: qActor || undefined,
        resource: qResource || undefined,
        resourceId: qEntity || undefined,
        requestId: qTrace || undefined,
        status: status || undefined,
        cursor,
        limit: 50,
      }),
    staleTime: 15_000,
  });

  const rows = useMemo(
    () =>
      (audit.data?.items ?? []).map((row) => [
        new Date(row.createdAt).toLocaleString(),
        row.action,
        row.resource,
        row.resourceId?.slice(0, 12) ?? "—",
        row.actor?.slice(0, 16) ?? "system",
        <StatusBadge key={row.id} status={row.status} />,
        row.traceId.slice(0, 18),
        row.changesSummary?.slice(0, 80) ?? "—",
      ]),
    [audit.data],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <SectionHead
        icon={ScrollText}
        tone="cyan"
        title="Audit Explorer"
        subtitle="Actor, action, entity, request/correlation ID. Passwords, OTP, tokens, and bank numbers are never shown."
        as="h1"
      />
      <div className="biz-glass-panel grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <input value={action} onChange={(e) => { setAction(e.target.value); setCursor(undefined); }} placeholder="Action" aria-label="Filter action" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm" />
        <input value={actor} onChange={(e) => { setActor(e.target.value); setCursor(undefined); }} placeholder="Actor" aria-label="Filter actor" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm" />
        <input value={resource} onChange={(e) => { setResource(e.target.value); setCursor(undefined); }} placeholder="Resource" aria-label="Filter resource" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm" />
        <input value={entity} onChange={(e) => { setEntity(e.target.value); setCursor(undefined); }} placeholder="Entity ID" aria-label="Filter entity id" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm" />
        <input value={trace} onChange={(e) => { setTrace(e.target.value); setCursor(undefined); }} placeholder="Request / correlation ID" aria-label="Filter request id" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setCursor(undefined); }} aria-label="Filter status" className="min-h-11 rounded-xl border border-[var(--color-biz-line)] bg-transparent px-3 text-sm">
          <option value="">All statuses</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILURE">FAILURE</option>
          <option value="DENIED">DENIED</option>
          <option value="PARTIAL">PARTIAL</option>
        </select>
      </div>
      {audit.isError ? (
        <div className="biz-glass-panel p-4" role="alert">
          <p className="text-sm">Audit explorer requires AUDIT_LOGS:READ.</p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void audit.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <DataTable
            title="Enterprise audit"
            columns={["Time", "Action", "Resource", "Entity", "Actor", "Status", "Trace", "Summary"]}
            rows={rows}
            loading={audit.isLoading}
            emptyMessage="No audit rows match these filters."
          />
          {audit.data?.hasMore ? (
            <button
              type="button"
              className="biz-btn"
              onClick={() => setCursor(audit.data?.nextCursor ?? undefined)}
            >
              Load older
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function AuditExplorerPage() {
  return (
    <Suspense fallback={<div className="biz-skeleton mx-auto h-64 max-w-7xl rounded-2xl" />}>
      <AuditExplorerInner />
    </Suspense>
  );
}
