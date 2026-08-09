"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, IndianRupee, Receipt, Wallet } from "lucide-react";
import { partnerApi } from "@/services/partner-api";
import { usePartnerStore } from "@/stores/partner-store";
import { resolveApiBase } from "@/lib/api-base";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function PartnerInvoicesPage() {
  const { data: invoices } = useQuery({ queryKey: ["partner", "invoices"], queryFn: () => partnerApi.invoices() });
  const { data: tax } = useQuery({ queryKey: ["partner", "tax"], queryFn: () => partnerApi.taxSummary() });

  const downloadPdf = async (earningId: string) => {
    const base = (resolveApiBase()).replace(/\/$/, "");
    const token = usePartnerStore.getState().accessToken;
    const res = await fetch(`${base}/api/providers/me/earnings/${earningId}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return;
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Invoices & Tax</h1>
        <p className="text-sm text-partner-muted">Earnings invoices, settlements & your tax summary</p>
      </div>

      {/* Tax summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Gross earnings", value: inr(tax?.grossEarnings ?? 0), icon: IndianRupee },
          { label: "Platform commission", value: inr(tax?.platformCommission ?? 0), icon: Receipt },
          { label: "Net earnings", value: inr(tax?.netEarnings ?? 0), icon: Wallet },
          { label: `Est. tax (FY ${tax?.financialYear ?? ""})`, value: inr(tax?.estimatedTax ?? 0), icon: FileText },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-partner-line bg-partner-surface p-4">
            <k.icon size={18} className="text-partner-accent" />
            <p className="mt-2 font-display text-xl font-bold">{k.value}</p>
            <p className="text-xs text-partner-muted">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Earnings invoices */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Earnings invoices</h2>
        <div className="overflow-hidden rounded-xl border border-partner-line">
          <table className="w-full text-sm">
            <thead className="bg-partner-surface text-left text-xs text-partner-muted">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Gross</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Net</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {(invoices?.earnings ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-partner-muted">No earnings invoices yet.</td>
                </tr>
              ) : (
                (invoices?.earnings ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-partner-line">
                    <td className="px-4 py-3 font-mono text-xs">{e.invoiceNumber}</td>
                    <td className="px-4 py-3">{e.service}</td>
                    <td className="px-4 py-3">{inr(e.gross)}</td>
                    <td className="px-4 py-3 text-red-500">− {inr(e.commission)}</td>
                    <td className="px-4 py-3 font-semibold">{inr(e.net)}</td>
                    <td className="px-4 py-3 text-partner-muted">{fmt(e.date)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void downloadPdf(e.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-partner-line px-2.5 py-1.5 text-xs font-medium hover:bg-partner-surface"
                      >
                        <Download size={13} /> PDF
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Settlements */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Settlement invoices</h2>
        <div className="overflow-hidden rounded-xl border border-partner-line">
          <table className="w-full text-sm">
            <thead className="bg-partner-surface text-left text-xs text-partner-muted">
              <tr>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Net paid</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {(invoices?.settlements ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-partner-muted">No settlements yet.</td>
                </tr>
              ) : (
                (invoices?.settlements ?? []).map((s) => (
                  <tr key={s.id} className="border-t border-partner-line">
                    <td className="px-4 py-3 font-mono text-xs">{s.settlementNumber}</td>
                    <td className="px-4 py-3">{inr(s.amount)}</td>
                    <td className="px-4 py-3 font-semibold">{inr(s.netAmount)}</td>
                    <td className="px-4 py-3 capitalize text-partner-muted">{s.status}</td>
                    <td className="px-4 py-3 text-partner-muted">{fmt(s.date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
