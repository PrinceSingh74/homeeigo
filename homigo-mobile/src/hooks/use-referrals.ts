import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";
import { useAppStore } from "@/lib/store";

export const referralKeys = {
  summary: ["referrals", "summary"] as const,
  history: ["referrals", "history"] as const,
  leaderboard: ["referrals", "leaderboard"] as const,
};

export function useReferralSummary() {
  return useQuery({ queryKey: referralKeys.summary, queryFn: () => coreApi.referrals.summary() });
}

export function useReferralHistory(enabled = true) {
  return useQuery({ queryKey: referralKeys.history, queryFn: () => coreApi.referrals.history(), enabled });
}

export function useReferralLeaderboard(enabled = true) {
  return useQuery({ queryKey: referralKeys.leaderboard, queryFn: () => coreApi.referrals.leaderboard(), enabled });
}

export function useReferralWithdraw() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);

  return async (amount: number) => {
    try {
      await coreApi.referrals.withdraw(amount);
      await Promise.all([
        qc.invalidateQueries({ queryKey: referralKeys.summary }),
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      showToast(`₹${amount.toLocaleString("en-IN")} moved to your wallet`);
      return true;
    } catch {
      showToast("Could not withdraw. Try again.");
      return false;
    }
  };
}
