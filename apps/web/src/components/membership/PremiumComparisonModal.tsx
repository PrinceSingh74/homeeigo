"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useSubscriptionPlans } from "@/hooks/use-subscription";
import { UpgradeCTA } from "@/components/membership/UpgradeCTA";
import { cn } from "@/lib/utils";

const TIERS = ["free", "silver", "gold", "platinum"] as const;
const FEATURES = [
  { key: "discount", label: "Booking discount", free: "—", silver: "5%", gold: "10%", platinum: "15%" },
  { key: "cashback", label: "Cashback", free: "—", silver: "2%", gold: "5%", platinum: "8%" },
  { key: "priority", label: "Priority queue", free: false, silver: true, gold: true, platinum: true },
  { key: "premium", label: "Premium services", free: false, silver: false, gold: true, platinum: true },
] as const;

type Props = { open: boolean; onClose: () => void; monthlySpend?: number };

export function PremiumComparisonModal({ open, onClose, monthlySpend = 3000 }: Props) {
  const { data: plans } = useSubscriptionPlans(open);
  const savings = useMemo(() => {
    const gold = plans?.find((p) => p.tier?.toLowerCase() === "gold");
    const price = gold?.price ?? 299;
    const discount = monthlySpend * 0.1;
    return Math.max(0, Math.round(discount * 12 - price * 12));
  }, [plans, monthlySpend]);

  return (
    <Modal open={open} onClose={onClose} title="Compare plans" size="lg">
      <p className="mb-4 text-sm text-muted">
        Estimated annual savings at ₹{monthlySpend.toLocaleString("en-IN")}/mo spend:{" "}
        <strong className="text-emerald-700">₹{savings.toLocaleString("en-IN")}</strong> with Gold
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2 pr-2">Feature</th>
              {TIERS.map((t) => (
                <th key={t} className="px-2 py-2 capitalize">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.key} className="border-b border-line/50">
                <td className="py-2 pr-2 font-medium">{f.label}</td>
                {TIERS.map((t) => {
                  const val = f[t];
                  return (
                    <td key={t} className="px-2 py-2">
                      {typeof val === "boolean" ? (
                        val ? (
                          <Check size={16} className="text-success" />
                        ) : (
                          <X size={16} className="text-muted" />
                        )
                      ) : (
                        <span className={cn(t === "platinum" && "font-semibold text-emerald-700")}>{val}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex justify-end">
        <UpgradeCTA label="Choose a plan" />
      </div>
    </Modal>
  );
}
