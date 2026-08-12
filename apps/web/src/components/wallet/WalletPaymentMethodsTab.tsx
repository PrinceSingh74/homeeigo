"use client";

import { useState } from "react";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { BadgeCheck, CreditCard, Landmark, Plus, Smartphone, Star, Trash2 } from "lucide-react";
import { AddPaymentMethodModal } from "@/components/wallet/AddPaymentMethodModal";
import {
  useDeletePaymentMethodMutation,
  usePaymentMethodsQuery,
  useSetDefaultPaymentMethodMutation,
} from "@/hooks/use-payment-methods";
import { useWalletDerived } from "@/hooks/use-derived-selectors";
import { cn } from "@/lib/utils";

const TYPE_ICON = {
  card: CreditCard,
  upi: Smartphone,
  bank: Landmark,
} as const;

export function WalletPaymentMethodsTab() {
  const { data: savedMethods, isLoading } = usePaymentMethodsQuery();
  const deleteMethod = useDeletePaymentMethodMutation();
  const setDefault = useSetDefaultPaymentMethodMutation();
  const { paymentMethods: recentMethods } = useWalletDerived();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const methods = savedMethods ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <StaticSkeleton key={i} className="wallet-panel h-24" />
            ))
          : null}

        {!isLoading && methods.length === 0 ? (
          <div className="wallet-panel col-span-full px-4 py-8 text-center text-sm text-muted">
            No saved payment methods yet. Add your UPI ID or card for faster checkout.
          </div>
        ) : null}

        {methods.map((pm) => {
          const Icon = TYPE_ICON[pm.type];
          const detail =
            pm.type === "upi"
              ? (pm.upiHandle ?? "UPI")
              : pm.type === "card"
                ? `${pm.network ?? "Card"}${pm.last4 ? ` •••• ${pm.last4}` : ""}`
                : "Bank account";
          return (
            <div
              key={pm.id}
              className={cn(
                "wallet-panel flex min-w-0 flex-col gap-3 p-4 sm:p-5",
                pm.isDefault && "border-emerald-500/40 ring-1 ring-emerald-500/20",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-600 dark:bg-emerald-600/20">
                  <Icon size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-content">{pm.label}</p>
                  <p className="truncate text-xs text-muted">{detail}</p>
                  {pm.isDefault && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-600">
                      <BadgeCheck size={12} />
                      Default
                    </span>
                  )}
                </div>
              </div>

              {confirmDeleteId === pm.id ? (
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs text-error">Remove this method?</p>
                  <button
                    type="button"
                    onClick={() => {
                      deleteMethod.mutate(pm.id);
                      setConfirmDeleteId(null);
                    }}
                    className="rounded-lg bg-error px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-content"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {!pm.isDefault && (
                    <button
                      type="button"
                      onClick={() => setDefault.mutate(pm.id)}
                      disabled={setDefault.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-content transition hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-60"
                    >
                      <Star size={12} />
                      Set default
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(pm.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-error hover:text-error"
                    aria-label={`Remove ${pm.label}`}
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas text-sm font-semibold text-emerald-600 transition hover:border-emerald-500 hover:bg-emerald-600/5 dark:bg-charcoal/50"
        >
          <Plus size={22} />
          Add payment method
        </button>
      </div>

      {recentMethods.length > 0 ? (
        <div className="wallet-panel p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">
            Recently used at checkout
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recentMethods.map((pm) => {
              const Icon = TYPE_ICON[pm.type];
              return (
                <span
                  key={pm.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/5 px-3 py-1.5 text-xs font-semibold text-content"
                >
                  <Icon size={14} className="text-emerald-600" />
                  {pm.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      <AddPaymentMethodModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
