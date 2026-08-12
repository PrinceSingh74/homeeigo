"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/stores/app-store";

export const entitlementKeys = {
  all: ["entitlements"] as const,
  usage: ["entitlements", "usage"] as const,
  insights: ["entitlements", "insights"] as const,
  cashback: ["entitlements", "cashback"] as const,
};

/** Server-side entitlements — single source of truth for premium UX. */
export function useEntitlements(enabled = true) {
  const setPremium = useAppStore((s) => s.setPremium);
  const q = useQuery({
    queryKey: entitlementKeys.all,
    queryFn: () => coreApi.subscriptions.entitlements(),
    enabled,
    // Subscribe/cancel mutations invalidate this key — membership doesn't
    // change behind the user's back mid-session.
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (q.data) setPremium(q.data.hasMembership);
  }, [q.data, setPremium]);

  return q;
}

export function useBenefitUsage(enabled = true) {
  return useQuery({
    queryKey: entitlementKeys.usage,
    queryFn: () => coreApi.subscriptions.benefitUsage(),
    enabled,
    staleTime: 60_000,
  });
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
    queryFn: () => coreApi.subscriptions.cashbackHistory("?limit=20"),
    enabled,
    staleTime: 60_000,
  });
}
