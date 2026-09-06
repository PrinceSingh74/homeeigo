"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

export default function TrustSafetyIncidentsPage() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const q = useQuery({
    queryKey: ["admin", "trust-safety", "incidents", status, type, severity],
    queryFn: () =>
      adminApi.trustSafety.incidents({
        status: status || undefined,
        type: type || undefined,
        severity: severity || undefined,
        page: 1,
      }),
  });
  const items = q.data?.items ?? [];
  const loading = q.isLoading && !q.data;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Safety incidents</h1>
      <div className="flex flex-wrap gap-2">
        <select
          className="min-h-11 rounded-lg border px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Incident status"
        >
          <option value="">All statuses</option>
          {["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="min-h-11 rounded-lg border px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Incident type"
        >
          <option value="">All types</option>
          {["SOS", "ACCIDENT", "THREAT", "MEDICAL", "CUSTOMER_SAFETY", "PARTNER_SAFETY", "LOCATION_DANGER", "OTHER"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <select
          className="min-h-11 rounded-lg border px-3 text-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Incident severity"
        >
          <option value="">All severities</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {q.isError && !q.data ? (
        <div className="rounded-2xl border p-6 text-sm" role="alert">
          <p className="font-medium">Could not load incidents.</p>
          <button type="button" className="mt-3 min-h-11 rounded-lg border px-4" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading incidents">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((row) => (
              <li key={String(row.id)} className="rounded-2xl border p-4">
                <Link href={`/trust-safety/incidents/${row.id}`} className="font-semibold">
                  {String(row.type)} · {String(row.severity)} · {String(row.partnerName)}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {String(row.status)}
                  {row.hasLocation ? " · location captured" : ""}
                </p>
              </li>
            ))}
          </ul>
          {items.length === 0 && !q.isError ? (
            <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              No incidents in this filter. SOS events appear here with location and assignment, not a public alarm.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
