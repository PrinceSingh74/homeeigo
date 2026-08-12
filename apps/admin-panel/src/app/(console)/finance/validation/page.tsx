"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle } from "lucide-react";
import { adminApi } from "@/services/admin-api";

export default function FinanceValidationPage() {
  const validationMut = useMutation({
    mutationFn: () => adminApi.runFinanceValidation(),
  });

  const result = validationMut.data;
  const checks = result?.checks ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Finance Readiness Validation</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">End-to-end finance platform verification</p>
        </div>
        <button
          type="button"
          disabled={validationMut.isPending}
          onClick={() => validationMut.mutate()}
          className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {validationMut.isPending ? "Validating…" : "Run validation"}
        </button>
      </div>

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="biz-card flex items-center gap-3 p-5">
              {result.status === "PASS" ? (
                <CheckCircle className="h-8 w-8 text-emerald-500" />
              ) : (
                <XCircle className="h-8 w-8 text-red-500" />
              )}
              <div>
                <p className="text-xs text-[var(--color-biz-muted)]">Status</p>
                <p className="text-xl font-bold">{result.status}</p>
              </div>
            </div>
            <div className="biz-card p-5">
              <p className="text-xs text-[var(--color-biz-muted)]">Score</p>
              <p className="text-xl font-bold">{result.score}%</p>
            </div>
            <div className="biz-card p-5">
              <p className="text-xs text-[var(--color-biz-muted)]">Payments (after)</p>
              <p className="text-xl font-bold">{result.afterScore.payments}/10</p>
            </div>
            <div className="biz-card p-5">
              <p className="text-xs text-[var(--color-biz-muted)]">Finance Ops (after)</p>
              <p className="text-xl font-bold">{result.afterScore.financeOps}/10</p>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-biz-line)] overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <th className="px-4 py-3">Check</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.name} className="border-b border-[var(--color-biz-line)] last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{c.name}</td>
                    <td className="px-4 py-3">{c.status}</td>
                    <td className="px-4 py-3 text-[var(--color-biz-muted)]">{c.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
