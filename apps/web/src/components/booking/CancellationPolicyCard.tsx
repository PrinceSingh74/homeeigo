"use client";

import { ShieldCheck } from "lucide-react";
import { useCancellationPolicyQuery } from "@/hooks/use-core-data";
import { cancellationPolicyView } from "@/lib/cancellation-policy";

/**
 * The server's cancellation policy (GET /api/bookings/cancellation-policy). Nothing here is a
 * default: without an answer the card names no window, percentage or refund time.
 */
export function CancellationPolicyCard({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useCancellationPolicyQuery();
  const view = cancellationPolicyView(data);
  return (
    <div
      className={
        compact
          ? "rounded-2xl border border-line bg-surface/40 p-4"
          : "mt-4 rounded-2xl border border-line bg-surface/50 p-4"
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={18} className="shrink-0 text-emerald-600" />
        <h4 className="text-sm font-bold text-content">Cancellation &amp; refund policy</h4>
      </div>
      {isLoading ? (
        <p role="status" className="text-xs text-muted">
          Loading the cancellation terms…
        </p>
      ) : view.rows.length === 0 ? (
        <p className="text-xs text-muted">The cancellation terms are shown before you confirm a cancellation.</p>
      ) : (
        <ul className="space-y-2 text-xs text-muted">
          {view.rows.map((t) => (
            <li key={t.id} className="flex justify-between gap-2">
              <span>
                <span className="font-semibold text-content">{t.label}</span>
                <span className="block text-[11px]">{t.window}</span>
              </span>
              <span className="shrink-0 font-bold text-success">{t.refundPercent}% refund</span>
            </li>
          ))}
          {view.notes.length > 0 ? (
            <li className="border-t border-line pt-2 text-[11px]">{view.notes.join(" ")}</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
