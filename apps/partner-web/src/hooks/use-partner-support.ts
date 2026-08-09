"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";

export const partnerSupportKeys = {
  tickets: (params: Record<string, string | number | undefined>) =>
    ["partner", "support", "tickets", params] as const,
  ticket: (id: string) => ["partner", "support", "ticket", id] as const,
};

export function usePartnerSupportTicketsQuery(
  params: Record<string, string | number | undefined> = {},
) {
  return useQuery({
    queryKey: partnerSupportKeys.tickets(params),
    queryFn: () => partnerApi.support.tickets(params),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

export function usePartnerSupportTicketQuery(id: string | undefined) {
  return useQuery({
    queryKey: partnerSupportKeys.ticket(id ?? ""),
    queryFn: () => partnerApi.support.ticketById(id!),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useCreatePartnerSupportTicketMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: partnerApi.support.createTicket,
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ["partner", "support"] });
      showToast(`Ticket ${ticket.ticketNumber} created`, "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });
}

export function usePartnerSupportReplyMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => partnerApi.support.reply(id, body),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: partnerSupportKeys.ticket(id) });
      void qc.invalidateQueries({ queryKey: ["partner", "support", "tickets"] });
      showToast("Reply sent", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });
}
