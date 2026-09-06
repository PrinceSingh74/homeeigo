"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";
import { cn } from "@/lib/cn";

const FILTERS = ["expiring", "expired", "restricted", "pending", "verified"] as const;

export default function TrustSafetyCompliancePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("expiring");
  const q = useQuery({
    queryKey: ["admin", "trust-safety", "compliance", filter],
    queryFn: () => adminApi.trustSafety.compliance({ filter, page: 1 }),
  });
  const unrestrict = useMutation({
    mutationFn: (providerId: string) => adminApi.trustSafety.unrestrict(providerId, "Admin unrestrict from compliance queue"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trust-safety", "compliance"] }),
  });
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Partner compliance</h1>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-11 rounded-full border px-3 text-sm capitalize",
              filter === f && "bg-foreground text-background",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Partner</th>
              <th className="p-3">Document</th>
              <th className="p-3">Expiry</th>
              <th className="p-3">Verification</th>
              <th className="p-3">Status</th>
              <th className="p-3">Restriction</th>
              <th className="p-3">Next action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={String(row.documentId)} className="border-b last:border-0">
                <td className="p-3">{String(row.partnerName)}</td>
                <td className="p-3">{String(row.documentType)}</td>
                <td className="p-3">{row.expiryDate ? new Date(String(row.expiryDate)).toLocaleDateString() : "—"}</td>
                <td className="p-3">{row.isVerified ? "Verified" : "Pending"}</td>
                <td className="p-3">{String(row.expiryState)}</td>
                <td className="p-3">
                  {row.restricted ? (
                    <button
                      type="button"
                      className="min-h-11 rounded-lg border px-3 text-xs"
                      onClick={() => unrestrict.mutate(String(row.partnerId))}
                    >
                      Unrestrict
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3">{String(row.nextAction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No documents in this filter.</p>
        ) : null}
      </div>
    </div>
  );
}
