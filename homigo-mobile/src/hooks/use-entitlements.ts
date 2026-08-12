import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/lib/store";

export const entitlementKeys = {
  all: ["entitlements"] as const,
  insights: ["entitlements", "insights"] as const,
  cashback: ["entitlements", "cashback"] as const,
};

export function useEntitlements(enabled = true) {
  const setPremium = useAppStore((s) => s.setPremium);
  const q = useQuery({
    queryKey: entitlementKeys.all,
    queryFn: () => coreApi.subscriptions.entitlements(),
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (q.data) setPremium(q.data.hasMembership);
  }, [q.data, setPremium]);

  return q;
}

export function useMembershipInsights(enabled = true) {
  return useQuery({
    queryKey: entitlementKeys.insights,
    queryFn: () => coreApi.subscriptions.insights(),
    enabled,
    staleTime: 60_000,
  });
}

export function useCashbackHistory(enabled = true) {
  return useQuery({
    queryKey: entitlementKeys.cashback,
    queryFn: () => coreApi.subscriptions.cashbackHistory(),
    enabled,
    staleTime: 60_000,
  });
}
