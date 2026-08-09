"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { usePartnerStore } from "@/stores/partner-store";

const enabled = () => {
  const status = usePartnerStore.getState().status;
  const token = usePartnerStore.getState().accessToken;
  return status === "authenticated" && Boolean(token);
};

export const partnerOsKeys = {
  attendance: ["partner", "os", "attendance"] as const,
  incentives: ["partner", "os", "incentives"] as const,
  forecast: ["partner", "os", "forecast"] as const,
  intelligence: ["partner", "os", "intelligence"] as const,
  rankings: ["partner", "os", "rankings"] as const,
  academy: ["partner", "os", "academy"] as const,
  compliance: ["partner", "os", "compliance"] as const,
  wellbeing: ["partner", "os", "wellbeing"] as const,
  rewards: ["partner", "os", "rewards"] as const,
  serviceHistory: ["partner", "os", "service-history"] as const,
  documents: ["partner", "os", "documents"] as const,
};

export function usePartnerAttendanceQuery() {
  return useQuery({
    queryKey: partnerOsKeys.attendance,
    queryFn: () => partnerApi.partnerOs.attendance(),
    enabled: enabled(),
    staleTime: 15_000,
  });
}

export function usePartnerCheckInMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partnerApi.partnerOs.checkIn(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerOsKeys.attendance }),
  });
}

export function usePartnerCheckOutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partnerApi.partnerOs.checkOut(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerOsKeys.attendance }),
  });
}

export function usePartnerIncentivesQuery() {
  return useQuery({
    queryKey: partnerOsKeys.incentives,
    queryFn: () => partnerApi.partnerOs.incentives(),
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function usePartnerForecastQuery() {
  return useQuery({
    queryKey: partnerOsKeys.forecast,
    queryFn: () => partnerApi.partnerOs.forecast(),
    enabled: enabled(),
    staleTime: 60_000,
  });
}

export function usePartnerIntelligenceQuery(days = 90) {
  return useQuery({
    queryKey: [...partnerOsKeys.intelligence, days],
    queryFn: () => partnerApi.partnerOs.intelligence(days),
    enabled: enabled(),
    staleTime: 60_000,
  });
}

export function usePartnerRankingsQuery() {
  return useQuery({
    queryKey: partnerOsKeys.rankings,
    queryFn: () => partnerApi.partnerOs.rankings(),
    enabled: enabled(),
    staleTime: 60_000,
  });
}

export function usePartnerAcademyQuery() {
  return useQuery({
    queryKey: partnerOsKeys.academy,
    queryFn: () => partnerApi.partnerOs.academy(),
    enabled: enabled(),
    staleTime: 60_000,
  });
}

export function usePartnerComplianceQuery() {
  return useQuery({
    queryKey: partnerOsKeys.compliance,
    queryFn: () => partnerApi.partnerOs.compliance(),
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function usePartnerWellbeingQuery() {
  return useQuery({
    queryKey: partnerOsKeys.wellbeing,
    queryFn: () => partnerApi.partnerOs.wellbeing(),
    enabled: enabled(),
    staleTime: 120_000,
  });
}

export function usePartnerRewardsOsQuery() {
  return useQuery({
    queryKey: partnerOsKeys.rewards,
    queryFn: () => partnerApi.partnerOs.rewards(),
    enabled: enabled(),
    staleTime: 30_000,
  });
}

export function usePartnerServiceHistoryQuery() {
  return useQuery({
    queryKey: partnerOsKeys.serviceHistory,
    queryFn: () => partnerApi.partnerOs.serviceHistory(),
    enabled: enabled(),
    staleTime: 20_000,
  });
}

export function usePartnerCompleteAcademyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, score }: { moduleId: string; score?: number }) =>
      partnerApi.partnerOs.completeAcademyModule(moduleId, score),
    onSuccess: () => void qc.invalidateQueries({ queryKey: partnerOsKeys.academy }),
  });
}
