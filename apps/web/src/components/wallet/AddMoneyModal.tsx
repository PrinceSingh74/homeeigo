"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useWalletTopUp } from "@/hooks/use-wallet-topup";
import { useWalletBalanceQuery } from "@/hooks/use-core-data";
import { cn } from "@/lib/utils";

const MIN = 100;
const MAX = 50000;
const PRESETS = [100, 500, 1000, 5000];

function validate(value: string): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return "Enter a valid whole amount";
  if (n < MIN) return `Minimum amount is ₹${MIN}`;
  if (n > MAX) return `Maximum amount is ₹${MAX.toLocaleString("en-IN")}`;
  return null;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function AddMoneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { topUp, reset, status, error, lastAmount, busy } = useWalletTopUp();
  const { data: balanceData } = useWalletBalanceQuery();
  const [value, setValue] = useState("");

  const close = useCallback(() => {
    if (busy) return; // can't dismiss mid-payment
    onClose();
    setValue("");
    reset();
  }, [busy, onClose, reset]);

  // Auto-close shortly after a successful top-up.
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => close(), 2200);
    return () => clearTimeout(t);
  }, [status, close]);

  const err = validate(value);
  const amount = Number(value);
  const valid = err === null && value !== "";
  const balance = balanceData?.balance ?? 0;

  const proceed = () => {
    if (!valid || busy) return;
    void topUp(amount);
  };

  const isForm = status === "idle" || busy;

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={isForm ? "Add money to wallet" : undefined}
    >
      {status === "success" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={56} className="text-success" strokeWidth={1.8} />
          <h3 className="font-display text-xl font-bold text-content">Payment successful</h3>
          <p className="text-sm text-muted">
            <span className="font-bold text-content">{inr(lastAmount)}</span> has been added to your wallet.
          </p>
          <p className="text-[11px] text-muted">Updating your balance…</p>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <XCircle size={56} className="text-error" strokeWidth={1.8} />
          <h3 className="font-display text-xl font-bold text-content">Payment not completed</h3>
          <p className="text-sm text-muted">{error}</p>
          <div className="mt-2 flex w-full gap-2">
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => reset()}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Current balance */}
          <div className="flex items-center gap-3 rounded-xl bg-canvas p-3 dark:bg-charcoal/60">
            <span className="grid size-9 place-items-center rounded-lg bg-emerald-600/10 text-emerald-600">
              <Wallet size={18} />
            </span>
            <div>
              <p className="text-[11px] text-muted">Current balance</p>
              <p className="font-display text-base font-bold text-content">{inr(balance)}</p>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <label className="text-xs font-medium text-muted">Enter amount</label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted">₹</span>
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                placeholder="0"
                className={cn(
                  "w-full rounded-xl border bg-surface py-2.5 pl-8 pr-3 text-lg font-bold text-content outline-none transition focus:border-emerald-500 disabled:opacity-60",
                  err ? "border-error" : "border-line",
                )}
              />
            </div>
            {err ? <p className="mt-1 text-xs text-error">{err}</p> : null}
          </div>

          {/* Quick select */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => setValue(String(p))}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60",
                  value === String(p)
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "border-line text-emerald-600 hover:bg-emerald-600/5",
                )}
              >
                {inr(p)}
              </button>
            ))}
          </div>

          {/* Details */}
          {valid && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <div className="flex justify-between text-muted">
                <span>Amount</span>
                <span className="font-medium text-content">{inr(amount)}</span>
              </div>
              <div className="mt-1.5 flex justify-between text-muted">
                <span>Processing fee</span>
                <span className="font-medium text-success">Free</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-bold text-content">
                <span>Total payable</span>
                <span>{inr(amount)}</span>
              </div>
            </div>
          )}

          {/* Payment method */}
          <div className="flex items-center gap-2 rounded-xl border border-line p-3">
            <CreditCard size={18} className="text-emerald-600" />
            <span className="text-sm font-semibold text-content">Razorpay</span>
            <span className="ml-auto text-[11px] text-muted">Cards · UPI · Wallets · Netbanking</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={proceed}
              disabled={!valid || busy}
              className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {status === "creating"
                ? "Creating order…"
                : status === "processing"
                  ? "Waiting for payment…"
                  : status === "verifying"
                    ? "Verifying…"
                    : valid
                      ? `Proceed to pay ${inr(amount)}`
                      : "Proceed to pay"}
            </button>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={13} className="text-success" /> Secured by Razorpay · 256-bit encrypted
          </p>
        </div>
      )}
    </Modal>
  );
}
