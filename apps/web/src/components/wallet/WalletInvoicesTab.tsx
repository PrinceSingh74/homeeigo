"use client";

import { Download } from "lucide-react";
import { useWalletDerived } from "@/hooks/use-derived-selectors";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { resolveApiBase } from "@/lib/api-base";

export function WalletInvoicesTab() {
  const showToast = useAppStore((s) => s.showToast);
  const { invoices } = useWalletDerived();
  const hasInvoices = invoices.length > 0;

  // Open the backend-generated invoice (auth-gated) in a new tab → browser
  // "Save as PDF". Only completed (paid) payments have an invoice.
  const downloadInvoice = async (inv: { id: string; status: string }) => {
    if (inv.status !== "paid") {
      showToast("Invoice is available once payment is completed", "info");
      return;
    }
    try {
      const token = useAuthStore.getState().accessToken;
      const apiBase = resolveApiBase().replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/payments/${inv.id}/invoice`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error("not available");
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast("Could not open invoice. Please try again.", "error");
    }
  };

  return (
    <div className="wallet-panel w-full min-w-0 overflow-hidden">
      <div className="hidden border-b border-line bg-canvas px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted dark:bg-charcoal/60 lg:grid lg:grid-cols-[1fr_120px_140px_100px]">
        <span>Invoice ID</span>
        <span>Amount</span>
        <span>Date</span>
        <span className="text-right">Action</span>
      </div>
      {!hasInvoices ? (
        <div className="px-6 py-8 text-center text-sm text-muted">
          No invoices yet. Completed payments will appear here.
        </div>
      ) : (
      <ul>
        {invoices.map((inv) => (
          <li
            key={inv.id}
            className="border-b border-line px-3 py-3.5 last:border-0 sm:px-6 sm:py-4 lg:grid lg:grid-cols-[1fr_120px_140px_100px] lg:items-center"
          >
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:contents">
              <div className="flex min-w-0 items-start justify-between gap-2 lg:block">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted lg:hidden">
                    Invoice
                  </p>
                  <span className="font-mono text-[13px] font-semibold text-content sm:text-sm">
                    {inv.id}
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase lg:hidden",
                    inv.status === "paid"
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {inv.status}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 sm:gap-4 lg:contents">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted lg:hidden">
                    Amount
                  </p>
                  <span className="font-mono text-[13px] font-semibold text-content sm:text-sm">
                    ₹{inv.amount.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="text-right lg:text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted lg:hidden">
                    Date
                  </p>
                  <span className="text-[12px] text-muted sm:text-sm">{inv.date}</span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span
                    className={cn(
                      "hidden rounded-md px-2 py-0.5 text-[10px] font-bold uppercase lg:inline",
                      inv.status === "paid"
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    {inv.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void downloadInvoice(inv)}
                    className="grid size-10 place-items-center rounded-lg border border-line text-emerald-600 transition hover:bg-emerald-600/5 sm:size-9"
                    aria-label={`Download invoice ${inv.id}`}
                  >
                    <Download size={16} />
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
