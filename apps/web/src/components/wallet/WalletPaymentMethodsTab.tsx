"use client";

import { CreditCard, Landmark, Plus, Smartphone } from "lucide-react";
import { WALLET_PAYMENT_METHODS } from "@/lib/wallet-dashboard";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const TYPE_ICON = {
  card: CreditCard,
  upi: Smartphone,
  bank: Landmark,
} as const;

export function WalletPaymentMethodsTab() {
  const showToast = useAppStore((s) => s.showToast);

  return (
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4">
      {WALLET_PAYMENT_METHODS.map((pm) => {
        const Icon = TYPE_ICON[pm.type];
        return (
          <div
            key={pm.id}
            className={cn(
              "wallet-panel flex min-w-0 items-center gap-3 p-4 sm:gap-4 sm:p-5",
              pm.primary && "border-primary/40 ring-1 ring-primary/20",
            )}
          >
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Icon size={22} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-content">{pm.label}</p>
              <p className="text-xs text-muted">{pm.detail}</p>
              {pm.primary && (
                <span className="mt-1 inline-block text-[10px] font-bold uppercase text-primary">
                  Primary
                </span>
              )}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => showToast("Add payment method — coming soon", "info")}
        className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/5 dark:bg-charcoal/50"
      >
        <Plus size={22} />
        Add payment method
      </button>
    </div>
  );
}
