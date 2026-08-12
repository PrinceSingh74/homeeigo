"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminAdjustmentInput } from "@/services/admin-api";

const TYPES = ["CREDIT", "DEBIT", "CORRECTION", "WRITE_OFF", "LIABILITY_ADJUSTMENT", "LEDGER_FIX"] as const;
const ACCOUNTS = [
  "ADJUSTMENT_CLEARING",
  "CUSTOMER_WALLET",
  "PLATFORM_REVENUE",
  "REFUND_LIABILITY",
  "PROVIDER_PAYABLE",
  "BANK_SETTLEMENT",
  "CHARGEBACK_LOSS",
  "HCOIN_LIABILITY",
];

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "text-amber-500",
  APPROVED: "text-blue-500",
  EXECUTED: "text-emerald-500",
  REJECTED: "text-red-500",
};

export default function FinanceAdjustmentsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("");
  const [form, setForm] = useState<AdminAdjustmentInput>({
    type: "CREDIT",
    direction: "CREDIT",
    amount: 0,
    reason: "",
  });

  const { data: adjustments, isLoading } = useQuery({
    queryKey: ["admin", "adjustments", filter],
    queryFn: () => adminApi.adjustments.list(filter || undefined),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "adjustments"] });
  const createMut = useMutation({ mutationFn: () => adminApi.adjustments.create(form), onSuccess: invalidate });
  const approveMut = useMutation({ mutationFn: (id: string) => adminApi.adjustments.approve(id), onSuccess: invalidate });
  const rejectMut = useMutation({
    mutationFn: (id: string) => adminApi.adjustments.reject(id, "Rejected by reviewer"),
    onSuccess: invalidate,
  });
  const executeMut = useMutation({ mutationFn: (id: string) => adminApi.adjustments.execute(id), onSuccess: invalidate });

  const exportUrl = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/admin/finance/audit-export/journals?format=csv`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Manual Financial Adjustments</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Maker-checker · ledger-journaled · fully audited</p>
        </div>
        <a href={exportUrl} className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold">
          Export journals
        </a>
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Create adjustment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            Type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AdminAdjustmentInput["type"] })}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Direction
            <select
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value as AdminAdjustmentInput["direction"] })}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            >
              <option value="CREDIT">CREDIT</option>
              <option value="DEBIT">DEBIT</option>
            </select>
          </label>
          <label className="text-sm">
            Amount (₹)
            <input
              type="number"
              value={form.amount || ""}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Target User ID (wallet adjustment)
            <input
              value={form.targetUserId ?? ""}
              onChange={(e) => setForm({ ...form, targetUserId: e.target.value || undefined })}
              placeholder="leave blank for pure ledger fix"
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Debit account (ledger fix)
            <select
              value={form.debitAccountCode ?? ""}
              onChange={(e) => setForm({ ...form, debitAccountCode: e.target.value || undefined })}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            >
              <option value="">—</option>
              {ACCOUNTS.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </label>
          <label className="text-sm">
            Credit account (ledger fix)
            <select
              value={form.creditAccountCode ?? ""}
              onChange={(e) => setForm({ ...form, creditAccountCode: e.target.value || undefined })}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            >
              <option value="">—</option>
              {ACCOUNTS.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">
          Reason
          <input
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm">
          Supporting notes
          <textarea
            value={form.supportingNotes ?? ""}
            onChange={(e) => setForm({ ...form, supportingNotes: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
          />
        </label>
        {createMut.isError && (
          <p className="mt-2 text-sm text-red-500">{(createMut.error as Error)?.message ?? "Failed"}</p>
        )}
        <button
          type="button"
          disabled={createMut.isPending || form.amount <= 0 || form.reason.length < 3}
          onClick={() => createMut.mutate()}
          className="mt-3 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createMut.isPending ? "Submitting…" : "Submit for approval"}
        </button>
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Adjustments</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="PENDING_APPROVAL">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        {isLoading ? (
          <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--color-biz-muted)]">
                <tr>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Dir</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(adjustments ?? []).map((a) => (
                  <tr key={a.id} className="border-t border-[var(--color-biz-line)]">
                    <td className="py-2 pr-4 font-mono text-xs">{a.reference}</td>
                    <td className="py-2 pr-4">{a.type}</td>
                    <td className="py-2 pr-4">{a.direction}</td>
                    <td className="py-2 pr-4">₹{a.amount.toLocaleString("en-IN")}</td>
                    <td className={`py-2 pr-4 font-semibold ${STATUS_COLORS[a.status] ?? ""}`}>{a.status}</td>
                    <td className="py-2 pr-4 max-w-[200px] truncate" title={a.reason}>{a.reason}</td>
                    <td className="py-2 pr-4 space-x-2 whitespace-nowrap">
                      {a.status === "PENDING_APPROVAL" && (
                        <>
                          <button type="button" onClick={() => approveMut.mutate(a.id)} className="text-blue-500 hover:underline">Approve</button>
                          <button type="button" onClick={() => rejectMut.mutate(a.id)} className="text-red-500 hover:underline">Reject</button>
                        </>
                      )}
                      {a.status === "APPROVED" && (
                        <button type="button" onClick={() => executeMut.mutate(a.id)} className="text-emerald-500 hover:underline">Execute</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
