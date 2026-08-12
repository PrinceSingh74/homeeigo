"use client";

import { ShieldCheck } from "lucide-react";

const DEFAULT_TIERS = [
  { label: "Free cancellation", window: "More than 24 hours before service", refundPercent: 100 },
  { label: "Standard window", window: "2–24 hours before service", refundPercent: 90 },
  { label: "Late cancellation", window: "Under 2 hours before service", refundPercent: 75 },
];

export function CancellationPolicyCard({ compact = false }: { compact?: boolean }) {
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
      <ul className="space-y-2 text-xs text-muted">
        {DEFAULT_TIERS.map((t) => (
          <li key={t.label} className="flex justify-between gap-2">
            <span>
              <span className="font-semibold text-content">{t.label}</span>
              <span className="block text-[11px]">{t.window}</span>
            </span>
            <span className="shrink-0 font-bold text-success">{t.refundPercent}% refund</span>
          </li>
        ))}
        <li className="border-t border-line pt-2 text-[11px]">
          If your professional cancels, you receive a <strong className="text-content">full refund</strong>.
          Wallet payments refund instantly; card/UPI in 5–7 business days.
        </li>
      </ul>
    </div>
  );
}
