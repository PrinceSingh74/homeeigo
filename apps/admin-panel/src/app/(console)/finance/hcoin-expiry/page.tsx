"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Clock } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function HCoinExpiryPage() {
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(365);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "hcoin-expiry"],
    queryFn: () => adminApi.hcoinExpiry.report(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "hcoin-expiry"] });
  const configMut = useMutation({
    mutationFn: (body: { enabled?: boolean; expiryDays?: number }) => adminApi.hcoinExpiry.updateConfig(body),
    onSuccess: invalidate,
  });
  const runMut = useMutation({ mutationFn: (dryRun: boolean) => adminApi.hcoinExpiry.run(dryRun), onSuccess: invalidate });

  const config = data?.config;
  const totals = data?.totals;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">H-Coin Expiry Accounting</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Expire aged coins · recognise promotional breakage revenue · DR H-Coin Liability / CR Breakage Revenue
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Expiry enabled" value={config?.enabled ? "ON" : "OFF"} icon={Clock} accent={config?.enabled ? "green" : "red"} loading={isLoading} />
        <KpiCard label="Total coins expired" value={String(totals?.coinsExpired ?? 0)} icon={Coins} loading={isLoading} />
        <KpiCard label="Breakage revenue" value={`₹${(totals?.breakageRevenue ?? 0).toLocaleString("en-IN")}`} icon={Coins} accent="green" loading={isLoading} />
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Controls</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Expiry period (days)
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 block w-40 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => configMut.mutate({ expiryDays: days })}
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
          >
            Save period
          </button>
          <button
            type="button"
            onClick={() => configMut.mutate({ enabled: !config?.enabled })}
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
          >
            {config?.enabled ? "Disable expiry" : "Enable expiry"}
          </button>
          <button
            type="button"
            disabled={runMut.isPending}
            onClick={() => runMut.mutate(true)}
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Dry run
          </button>
          <button
            type="button"
            disabled={runMut.isPending || !config?.enabled}
            onClick={() => runMut.mutate(false)}
            className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {runMut.isPending ? "Running…" : "Run expiry now"}
          </button>
        </div>
        {runMut.data && (
          <p className="mt-3 text-sm text-[var(--color-biz-muted)]">
            {runMut.data.dryRun ? "Dry run" : "Executed"}: {runMut.data.coinsExpired} coins across {runMut.data.walletsAffected} wallets (₹{runMut.data.rupeeValue})
          </p>
        )}
        {runMut.isError && <p className="mt-2 text-sm text-red-500">{(runMut.error as Error)?.message}</p>}
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Expiry runs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--color-biz-muted)]">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Coins expired</th>
                <th className="py-2 pr-4">Wallets</th>
                <th className="py-2 pr-4">Rupee value</th>
              </tr>
            </thead>
            <tbody>
              {(data?.runs ?? []).map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-biz-line)]">
                  <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4">{r.coinsExpired}</td>
                  <td className="py-2 pr-4">{r.walletsAffected}</td>
                  <td className="py-2 pr-4">₹{r.rupeeValue.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
