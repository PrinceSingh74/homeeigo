"use client";

import { useState } from "react";
import { CreditCard, Landmark, ShieldCheck, Smartphone } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAddPaymentMethodMutation } from "@/hooks/use-payment-methods";
import { cn } from "@/lib/utils";

type MethodType = "UPI" | "CARD" | "BANK";

const TYPE_OPTIONS: { value: MethodType; label: string; icon: typeof CreditCard }[] = [
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
  { value: "BANK", label: "Bank", icon: Landmark },
];

const CARD_NETWORKS = ["Visa", "Mastercard", "RuPay", "Amex", "Other"];

export function AddPaymentMethodModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addMethod = useAddPaymentMethodMutation();
  const [type, setType] = useState<MethodType>("UPI");
  const [label, setLabel] = useState("");
  const [upiHandle, setUpiHandle] = useState("");
  const [last4, setLast4] = useState("");
  const [network, setNetwork] = useState(CARD_NETWORKS[0]);
  const [setDefault, setSetDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel("");
    setUpiHandle("");
    setLast4("");
    setNetwork(CARD_NETWORKS[0]);
    setSetDefault(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    setError(null);
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return setError("Give this payment method a name (e.g. Personal UPI).");
    if (type === "UPI") {
      const handle = upiHandle.trim();
      if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(handle)) {
        return setError("Enter a valid UPI ID, e.g. name@bank");
      }
    }
    if (type === "CARD" && last4 && !/^\d{4}$/.test(last4)) {
      return setError("Card last 4 digits must be exactly 4 numbers.");
    }

    addMethod.mutate(
      {
        type,
        label: trimmedLabel,
        upiHandle: type === "UPI" ? upiHandle.trim() : undefined,
        last4: type === "CARD" && last4 ? last4 : undefined,
        network: type === "CARD" ? network : undefined,
        setDefault,
      },
      { onSuccess: close },
    );
  };

  const inputClass =
    "w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-emerald-500";

  return (
    <Modal open={open} onClose={close} title="Add payment method" size="md">
      <div className="flex gap-2">
        {TYPE_OPTIONS.map(({ value, label: optLabel, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-xs font-bold transition",
              type === value
                ? "border-emerald-500 bg-emerald-600/10 text-emerald-600"
                : "border-line text-muted hover:border-emerald-500/40",
            )}
          >
            <Icon size={20} />
            {optLabel}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Nickname</span>
          <input
            type="text"
            value={label}
            maxLength={50}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              type === "UPI" ? "Personal UPI" : type === "CARD" ? "HDFC Credit Card" : "Salary account"
            }
            className={inputClass}
          />
        </label>

        {type === "UPI" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">UPI ID</span>
            <input
              type="text"
              value={upiHandle}
              onChange={(e) => setUpiHandle(e.target.value)}
              placeholder="name@bank"
              className={inputClass}
            />
          </label>
        )}

        {type === "CARD" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Last 4 digits (optional)</span>
              <input
                type="text"
                inputMode="numeric"
                value={last4}
                maxLength={4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
                placeholder="1234"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Network</span>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                className={inputClass}
              >
                {CARD_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-content">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(e) => setSetDefault(e.target.checked)}
            className="size-4 accent-[#059669]"
          />
          Set as default payment method
        </label>

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <div className="flex items-start gap-2 rounded-2xl bg-emerald-600/5 p-3 text-xs text-muted">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          We never store full card numbers, CVV, or expiry dates. All payments are processed
          securely by Razorpay — this only saves a reference for faster checkout.
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={addMethod.isPending}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {addMethod.isPending ? "Saving…" : "Save payment method"}
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
