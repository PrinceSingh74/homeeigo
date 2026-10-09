"use client";

import { useEffect, useState } from "react";
import { LegalStatusPill } from "@/components/legal/LegalStatusPill";
import { apiRequest } from "@/services/auth/api-client";
import type { ApiResponse } from "@/types/auth";
import { cancellationPolicyView, type CancellationPolicyResponse } from "@/lib/cancellation-policy";

/**
 * The published tiers are public. This page must not import `@/hooks/use-core-data`: that module
 * also pulls the booking client, wallet queries, and auth stores into a document that only needs
 * one GET. Same path and `auth: false` as `coreApi.bookings.cancellationPolicy`.
 */
function usePublishedCancellationPolicy() {
  const [data, setData] = useState<CancellationPolicyResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    apiRequest<ApiResponse<CancellationPolicyResponse>>("/api/bookings/cancellation-policy", { auth: false })
      .then((body) => {
        if (live) setData(body.data ?? null);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, []);
  return { data: data ?? null, isLoading: data === undefined };
}

/**
 * Cancellation fee tiers on the refund policy page — a table on tablet and up, stacked rows on
 * phones. The tiers are the server's (GET /api/bookings/cancellation-policy), the same ones a
 * cancellation is charged by. This page used to print its own table, and the two had drifted apart.
 * Without an answer no window or percentage is shown.
 */
export function RefundTierTable() {
  const { data, isLoading } = usePublishedCancellationPolicy();
  const rows = cancellationPolicyView(data).rows.map((t) => ({
    ...t,
    fee: t.refundPercent === 100 ? "Free" : `${100 - t.refundPercent}%`,
    note: `${t.label} — ${t.refundPercent}% refund`,
  }));

  if (isLoading) {
    return (
      <p role="status" className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        Loading the cancellation fees…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        The cancellation fee that applies to your booking is shown before you confirm a cancellation.
      </p>
    );
  }

  return (
    <div data-testid="refund-tiers">
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface sm:block">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cancellation fee tiers (scrollable)">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <caption className="sr-only">Cancellation fee by how far ahead of the slot you cancel</caption>
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">
                  When you cancel
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Cancellation fee
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  What it means
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((tier) => (
                <tr key={tier.id}>
                  <th scope="row" className="px-4 py-3.5 text-left font-semibold text-content">
                    {tier.window}
                  </th>
                  <td className="px-4 py-3.5">
                    <LegalStatusPill tone={tier.fee === "Free" ? "positive" : "caution"}>{tier.fee}</LegalStatusPill>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{tier.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
        {rows.map((tier) => (
          <li key={tier.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold leading-snug text-content">{tier.window}</p>
              <LegalStatusPill tone={tier.fee === "Free" ? "positive" : "caution"}>{tier.fee}</LegalStatusPill>
            </div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">{tier.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
