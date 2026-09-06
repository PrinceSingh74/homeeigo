"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type PartnerLeadListQuery, type PartnerLeadStatus } from "@/services/admin-api";

export const partnerLeadKeys = {
  all: ["admin", "partner-leads"] as const,
  list: (params: PartnerLeadListQuery) => ["admin", "partner-leads", params] as const,
  detail: (id: string) => ["admin", "partner-lead", id] as const,
  transitions: (id: string) => ["admin", "partner-lead", id, "transitions"] as const,
  admins: ["admin", "rbac-admins"] as const,
};

export function usePartnerLeadList(params: PartnerLeadListQuery) {
  return useQuery({
    queryKey: partnerLeadKeys.list(params),
    queryFn: () => adminApi.partnerAcquisition.listLeads(params),
  });
}

export function usePartnerLeadDetail(id?: string) {
  return useQuery({
    queryKey: partnerLeadKeys.detail(id ?? ""),
    queryFn: () => adminApi.partnerAcquisition.getLead(id!),
    enabled: Boolean(id),
  });
}

export function usePartnerLeadTransitions(id?: string) {
  return useQuery({
    queryKey: partnerLeadKeys.transitions(id ?? ""),
    queryFn: () => adminApi.partnerAcquisition.getLeadTransitions(id!),
    enabled: Boolean(id),
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: partnerLeadKeys.admins,
    queryFn: async () => {
      const data = await adminApi.rbac.admins();
      return (data.admins ?? []) as Array<{
        id: string;
        user?: { firstName?: string; lastName?: string; email?: string };
      }>;
    },
    staleTime: 60_000,
  });
}

export function usePartnerLeadMutations(leadId?: string) {
  const qc = useQueryClient();

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: partnerLeadKeys.all });
    if (leadId) {
      await qc.invalidateQueries({ queryKey: partnerLeadKeys.detail(leadId) });
      await qc.invalidateQueries({ queryKey: partnerLeadKeys.transitions(leadId) });
    }
  };

  const assign = useMutation({
    mutationFn: (assignedToAdminId: string) =>
      adminApi.partnerAcquisition.assignLead(leadId!, assignedToAdminId),
    onSuccess: invalidate,
  });

  const updateStatus = useMutation({
    mutationFn: (body: { status: PartnerLeadStatus; reason?: string }) =>
      adminApi.partnerAcquisition.updateStatus(leadId!, body),
    onSuccess: invalidate,
  });

  const setFollowUp = useMutation({
    mutationFn: (body: { nextFollowUpAt: string; followUpReason?: string }) =>
      adminApi.partnerAcquisition.setFollowUp(leadId!, body),
    onSuccess: invalidate,
  });

  const logActivity = useMutation({
    mutationFn: (body: { type: string; title: string; description?: string }) =>
      adminApi.partnerAcquisition.logActivity(leadId!, body),
    onSuccess: invalidate,
  });

  const updateNotes = useMutation({
    mutationFn: (notes: string) => adminApi.partnerAcquisition.updateNotes(leadId!, notes),
    onSuccess: invalidate,
  });

  const startApplication = useMutation({
    mutationFn: () => adminApi.partnerAcquisition.startApplication(leadId!),
    onSuccess: invalidate,
  });

  return { assign, updateStatus, setFollowUp, logActivity, updateNotes, startApplication, invalidate };
}
