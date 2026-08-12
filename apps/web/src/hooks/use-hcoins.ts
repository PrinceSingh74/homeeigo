"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";
import { useAppStore } from "@/stores/app-store";

export const hcoinKeys = {
  summary: ["hcoins", "summary"] as const,
  history: ["hcoins", "history"] as const,
};

export function useHCoinSummary() {
  return useQuery({ queryKey: hcoinKeys.summary, queryFn: () => coreApi.hcoins.summary() });
}

export function useHCoinHistory(enabled = true) {
  return useQuery({ queryKey: hcoinKeys.history, queryFn: () => coreApi.hcoins.history(), enabled });
}

export function useHCoinRedeem() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);

  return async (coins: number) => {
    try {
      const r = await coreApi.hcoins.redeem(coins);
      await Promise.all([
        qc.invalidateQueries({ queryKey: hcoinKeys.summary }),
        qc.invalidateQueries({ queryKey: hcoinKeys.history }),
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      showToast(`Redeemed for ₹${r.rupees} wallet credit`, "success");
      return true;
    } catch {
      showToast("Could not redeem. Please try again.", "error");
      return false;
    }
  };
}
