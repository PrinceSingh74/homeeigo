"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

export default function TrustSafetyRiskPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("REVIEW");
  const q = useQuery({
    queryKey: ["admin", "trust-safety", "risk", status],
    queryFn: () => adminApi.trustSafety.risk({ reviewStatus: status, page: 1 }),
  });
  const review = useMutation({
    mutationFn: (input: { providerId: string; action: string }) =>
      adminApi.trustSafety.review(input.providerId, input.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trust-safety", "risk"] }),
  });
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Partner risk queue</h1>
      <p className="text-sm text-muted-foreground">
        Scores are explainable signal totals. A single weak signal never auto-punishes.
      </p>
      <select
        className="min-h-11 rounded-lg border px-3 text-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label="Review status"
      >
        {["MONITOR", "REVIEW", "RESTRICT", "SUSPEND", "CLEARED"].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <ul className="space-y-2">
        {items.map((row) => (
          <li key={String(row.providerId)} className="rounded-2xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/trust-safety/risk/${row.providerId}`} className="font-semibold">
                {String(row.partnerName)} · {String(row.riskLevel)} ({String(row.riskScore)})
              </Link>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => review.mutate({ providerId: String(row.providerId), action: "CLEAR" })}>
                  Clear
                </button>
                <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => review.mutate({ providerId: String(row.providerId), action: "RESTRICT" })}>
                  Restrict
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {typeof row.explanation === "object" && row.explanation && "why" in (row.explanation as object)
                ? String((row.explanation as { why: string }).why)
                : String(row.reviewStatus)}
            </p>
          </li>
        ))}
      </ul>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
          No partners in this review state. Risk is intelligence — a single weak signal stays on Monitor.
        </p>
      ) : null}
    </div>
  );
}
