"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

export default function TrustSafetyIncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const me = useQuery({ queryKey: ["admin", "rbac-me"], queryFn: () => adminApi.rbac.me() });
  const q = useQuery({
    queryKey: ["admin", "trust-safety", "incident", params.id],
    queryFn: () => adminApi.trustSafety.incident(params.id),
    enabled: Boolean(params.id),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "trust-safety", "incident", params.id] });
  const ack = useMutation({
    mutationFn: () => adminApi.trustSafety.acknowledgeIncident(params.id),
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: () => {
      const userId = me.data?.userId;
      if (!userId) throw new Error("Not signed in");
      return adminApi.trustSafety.assignIncident(params.id, userId);
    },
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: () => adminApi.trustSafety.resolveIncident(params.id, notes.trim() || "Resolved by ops"),
    onSuccess: invalidate,
  });
  const d = q.data;
  const emergency = d?.emergencyContact as { name?: string | null; phoneMasked?: string | null } | undefined;
  const live = d?.liveLocation as { latitude?: number; longitude?: number; lastUpdated?: string } | undefined;
  const timeline = (d?.timeline as Array<{ id: string; action: string; description?: string | null; createdAt: string }> | undefined) ?? [];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link href="/trust-safety/incidents" className="text-sm text-muted-foreground hover:underline">
        Back to incidents
      </Link>
      <h1 className="text-2xl font-semibold">Incident {params.id.slice(0, 8)}</h1>
      {d ? (
        <>
          <section className="rounded-2xl border bg-card p-4 text-sm">
            <p>
              <strong>Type</strong> {String(d.type)} · {String(d.severity)} · {String(d.status)}
            </p>
            <p className="mt-2">
              <strong>Incident location</strong>{" "}
              {d.latitude != null ? `${d.latitude}, ${d.longitude}` : "Not captured"}
            </p>
            <p className="mt-2">
              <strong>Live location</strong>{" "}
              {live?.latitude != null ? `${live.latitude}, ${live.longitude}` : "Unavailable"}
            </p>
            <p className="mt-2">
              <strong>Emergency contact</strong> {emergency?.name ?? "—"} · {emergency?.phoneMasked ?? "—"}
            </p>
            <p className="mt-2">
              <strong>Assigned</strong> {d.assignedTo ? String(d.assignedTo) : "Unassigned"}
            </p>
            <label className="mt-4 block text-sm font-medium">
              Resolution notes
              <textarea
                className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label="Resolution notes"
                required
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => assign.mutate()}>
                Assign to me
              </button>
              <button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => ack.mutate()}>
                Acknowledge
              </button>
              <button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => resolve.mutate()}>
                Resolve
              </button>
            </div>
          </section>
          <section className="rounded-2xl border p-4">
            <h2 className="text-sm font-semibold">Timeline</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {timeline.map((item) => (
                <li key={item.id} className="rounded-xl border p-3">
                  <p className="font-medium">{item.action}</p>
                  <p className="text-muted-foreground">
                    {item.description ?? "—"} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : q.isError ? (
        <div className="rounded-2xl border p-6 text-sm" role="alert">
          <p className="font-medium">Could not load this incident.</p>
          <button type="button" className="mt-3 min-h-11 rounded-lg border px-4" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div
          className="h-40 animate-pulse rounded-2xl border bg-muted/40"
          role="status"
          aria-busy="true"
          aria-label="Loading incident"
        />
      )}
    </div>
  );
}
