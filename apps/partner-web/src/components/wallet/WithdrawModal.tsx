"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, Loader2, X } from "lucide-react";
import { useWithdrawMutation } from "@/hooks/use-partner-data";
import { getErrorMessage } from "@/lib/api-error";
import { formatInr } from "@/lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  walletBalance: number;
};

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function WithdrawModal({ open, onClose, walletBalance }: Props) {
  const withdrawMutation = useWithdrawMutation();
  const [amount, setAmount] = useState<string>("");
  const [accountHolder, setAccountHolder] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setAccountHolder("");
      setBankAccountNumber("");
      setIfscCode("");
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !withdrawMutation.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, withdrawMutation.isPending, onClose]);

  if (!open) return null;

  const numericAmount = Number(amount);

  async function handleSubmit() {
    setFormError(null);
    if (!accountHolder.trim()) {
      setFormError("Enter the account holder name");
      return;
    }
    if (bankAccountNumber.replace(/\D/g, "").length < 9) {
      setFormError("Enter a valid bank account number");
      return;
    }
    if (!IFSC_REGEX.test(ifscCode.trim().toUpperCase())) {
      setFormError("Enter a valid IFSC code");
      return;
    }
    if (numericAmount <= 0 || numericAmount > walletBalance) {
      setFormError(`Amount must be between ₹1 and ${formatInr(walletBalance)}`);
      return;
    }
    try {
      await withdrawMutation.mutateAsync({
        amount: Math.floor(numericAmount),
        bankAccountNumber: bankAccountNumber.replace(/\s/g, ""),
        ifscCode: ifscCode.trim().toUpperCase(),
        accountHolder: accountHolder.trim(),
      });
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  const isSubmitting = withdrawMutation.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={() => !isSubmitting && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-partner-line bg-partner-card p-5 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => !isSubmitting && onClose()}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-partner-muted hover:bg-partner-bg/60"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-partner-primary/20 text-partner-primary">
            <ArrowUpRight className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-semibold">Withdraw to bank</h3>
            <p className="mt-1 text-xs text-partner-muted">
              Available balance:{" "}
              <span className="font-semibold text-partner-text">
                {formatInr(walletBalance)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="Amount (₹)" htmlFor="wf-amount">
            <input
              id="wf-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={walletBalance}
              disabled={isSubmitting}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500"
              className={fieldClass}
            />
          </Field>

          <Field label="Account holder name" htmlFor="wf-holder">
            <input
              id="wf-holder"
              type="text"
              disabled={isSubmitting}
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
              placeholder="As per bank records"
              className={fieldClass}
            />
          </Field>

          <Field label="Bank account number" htmlFor="wf-acct">
            <input
              id="wf-acct"
              type="text"
              inputMode="numeric"
              disabled={isSubmitting}
              value={bankAccountNumber}
              onChange={(e) =>
                setBankAccountNumber(e.target.value.replace(/\D/g, ""))
              }
              placeholder="XXXXXXXXXX"
              className={fieldClass}
            />
          </Field>

          <Field label="IFSC code" htmlFor="wf-ifsc">
            <input
              id="wf-ifsc"
              type="text"
              disabled={isSubmitting}
              value={ifscCode}
              onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
              maxLength={11}
              placeholder="HDFC0001234"
              className={fieldClass}
            />
          </Field>

          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-partner-danger/30 bg-partner-danger/10 px-3 py-2 text-xs text-partner-danger"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
            className="rounded-lg border border-partner-line px-3 py-2 text-sm font-medium hover:bg-partner-bg/60 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-partner-primary px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
            {isSubmitting ? "Submitting…" : "Request withdrawal"}
          </button>
        </div>
        <p className="mt-3 text-[10px] text-partner-muted">
          Withdrawals typically settle in 1–3 business days. You&apos;ll receive a
          notification once processed.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-partner-muted" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const fieldClass =
  "w-full rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary disabled:opacity-60";
