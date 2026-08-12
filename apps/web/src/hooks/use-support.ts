"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { getErrorMessage } from "@/lib/auth/errors";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";

export const supportKeys = {
  tickets: (params: Record<string, string | number | undefined> = {}) =>
    ["support", "tickets", params] as const,
  ticket: (id: string) => ["support", "ticket", id] as const,
};

function buildQuery(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function useSupportTicketsQuery(
  params: Record<string, string | number | undefined> = { limit: 50, page: 1 },
) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: supportKeys.tickets(params),
    queryFn: () => coreApi.support.tickets(buildQuery(params)),
    enabled: isAuthenticated,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

export function useSupportTicketQuery(id: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: supportKeys.ticket(id ?? ""),
    queryFn: () => coreApi.support.ticketById(id!),
    enabled: isAuthenticated && Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useCreateSupportTicketMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: Parameters<typeof coreApi.support.createTicket>[0]) =>
      coreApi.support.createTicket(payload),
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ["support"] });
      showToast(`Ticket ${ticket.ticketNumber} created — our team will respond soon`, "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useSupportReplyMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => coreApi.support.reply(id, body),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: supportKeys.ticket(id) });
      void qc.invalidateQueries({ queryKey: ["support", "tickets"] });
      showToast("Reply sent", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}
