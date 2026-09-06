"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

type RiskDetail = {
  profile?: {
    providerId: string;
    riskScore: number;
    riskLevel: string;
    reviewStatus: string;
    lastEvaluatedAt: string;
    explanation?: { why?: string; signals?: Array<{ type: string; count: number; contribution: number }> } | null;
    reviewNotes?: string | null;
  } | null;
  signals?: Array<{
    id: string;
    type: string;
    source: string;
    severity: number;
    confidence?: number | null;
    createdAt: string;
    evidence?: Record<string, unknown>;
  }>;
  totalSignals?: number;
};

export default function TrustSafetyRiskDetailPage() {
  const params = useParams<{ providerId: string }>();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const q = useQuery({
    queryKey: ["admin", "trust-safety", "risk", params.providerId],
    queryFn: () => adminApi.trustSafety.riskDetail(params.providerId) as Promise<RiskDetail>,
    enabled: Boolean(params.providerId),
  });
  const review = useMutation({
    mutationFn: (action: string) => adminApi.trustSafety.review(params.providerId, action, notes || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trust-safety", "risk"] }),
  });
  const p = q.data?.profile;
  const explanation = p?.explanation;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link href="/trust-safety/risk" className="text-sm text-muted-foreground hover:underline">
        Back to risk queue
      </Link>
      <h1 className="text-2xl font-semibold">Partner risk</h1>
      {q.isLoading && !p ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading risk profile…
        </p>
      ) : null}
      {p ? (
        <section className="rounded-2xl border bg-card p-4 text-sm">
          <p>
            <span className="font-semibold uppercase" aria-label={`Risk level ${p.riskLevel}`}>
              {p.riskLevel}
            </span>{" "}
            · score {p.riskScore} · {p.reviewStatus}
          </p>
          <p className="mt-2 text-muted-foreground">{explanation?.why ?? "No explanation yet."}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last evaluated {p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : "—"}
          </p>
          {explanation?.signals?.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {explanation.signals.map((s) => (
                <li key={s.type}>
                  {s.count} {s.type.replace(/_/g, " ").toLowerCase()} (contribution {s.contribution})
                </li>
              ))}
            </ul>
          ) : null}
          <label className="mt-4 block text-sm font-medium">
            Review notes
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label="Risk review notes"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {["MONITOR", "REVIEW", "CLEAR", "RESTRICT", "SUSPEND"].map((action) => (
              <button
                key={action}
                type="button"
                className="min-h-11 rounded-lg border px-4 text-sm capitalize"
                onClick={() => review.mutate(action)}
              >
                {action.toLowerCase()}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{q.isLoading ? "Loading…" : "No risk profile yet."}</p>
      )}
      <section className="rounded-2xl border p-4">
        <h2 className="text-sm font-semibold">Signals ({q.data?.totalSignals ?? 0})</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(q.data?.signals ?? []).map((s) => (
            <li key={s.id} className="rounded-xl border p-3">
              <p className="font-medium">
                {s.type} · severity {s.severity}
              </p>
              <p className="text-muted-foreground">
                {s.source} · {new Date(s.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
