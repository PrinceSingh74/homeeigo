"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi, type SavedPaymentMethod } from "@/services/core/api";
import { getErrorMessage } from "@/lib/auth/errors";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";

export const paymentMethodKeys = {
  list: ["wallet", "payment-methods"] as const,
};

export function usePaymentMethodsQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: paymentMethodKeys.list,
    queryFn: () => coreApi.wallet.paymentMethods(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

export function useAddPaymentMethodMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: Parameters<typeof coreApi.wallet.addPaymentMethod>[0]) =>
      coreApi.wallet.addPaymentMethod(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.list });
      showToast("Payment method saved", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useDeletePaymentMethodMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (id: string) => coreApi.wallet.deletePaymentMethod(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: paymentMethodKeys.list });
      const prev = qc.getQueryData<SavedPaymentMethod[]>(paymentMethodKeys.list);
      if (prev) {
        qc.setQueryData(
          paymentMethodKeys.list,
          prev.filter((m) => m.id !== id),
        );
      }
      return { prev };
    },
    onError: (error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(paymentMethodKeys.list, ctx.prev);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: () => showToast("Payment method removed", "success"),
    onSettled: () => qc.invalidateQueries({ queryKey: paymentMethodKeys.list }),
  });
}

export function useSetDefaultPaymentMethodMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (id: string) => coreApi.wallet.setDefaultPaymentMethod(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: paymentMethodKeys.list });
      const prev = qc.getQueryData<SavedPaymentMethod[]>(paymentMethodKeys.list);
      if (prev) {
        qc.setQueryData(
          paymentMethodKeys.list,
          prev.map((m) => ({ ...m, isDefault: m.id === id })),
        );
      }
      return { prev };
    },
    onError: (error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(paymentMethodKeys.list, ctx.prev);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: () => showToast("Default payment method updated", "success"),
    onSettled: () => qc.invalidateQueries({ queryKey: paymentMethodKeys.list }),
  });
}
