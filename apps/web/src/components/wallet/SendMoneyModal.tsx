"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Send, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";
import { AuthApiError } from "@/lib/auth/errors";
import { useAppStore } from "@/stores/app-store";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const MIN = 1;
const MAX = 10000;

const ERR: Record<string, string> = {
  INSUFFICIENT_BALANCE: "Not enough wallet balance.",
  EXCEEDS_TXN_LIMIT: `Max ${inr(MAX)} per transfer.`,
  EXCEEDS_DAILY_LIMIT: "Daily transfer limit reached.",
  RECIPIENT_NOT_FOUND: "No HOMEEIGO user found for that phone / email / code.",
  CANNOT_SEND_TO_SELF: "You can't send money to yourself.",
  INVALID_OTP: "Incorrect OTP. Please try again.",
  INVALID_AMOUNT: "Enter a valid amount.",
};

export function SendMoneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const [step, setStep] = useState<"form" | "otp" | "success">("form");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState("");
  const [transferId, setTransferId] = useState("");
  const [maskedRecipient, setMaskedRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  const formValid = recipient.trim().length >= 3 && Number.isFinite(amt) && amt >= MIN && amt <= MAX;

  const close = () => {
    onClose();
    setTimeout(() => {
      setStep("form");
      setRecipient("");
      setAmount("");
      setNote("");
      setOtp("");
      setError(null);
    }, 200);
  };

  const send = async () => {
    if (!formValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await coreApi.transfers.initiate(recipient.trim(), amt, note.trim() || undefined);
      setTransferId(r.transferId);
      setMaskedRecipient(r.recipient);
      if (r.devOtp) setOtp(r.devOtp); // dev convenience
      setStep("otp");
    } catch (e) {
      setError(e instanceof AuthApiError ? ERR[e.code ?? ""] ?? "Could not start the transfer." : "Could not start the transfer.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (otp.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await coreApi.transfers.confirm(transferId, otp.trim());
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      setStep("success");
      showToast(`${inr(amt)} sent to ${maskedRecipient}`, "success");
    } catch (e) {
      setError(e instanceof AuthApiError ? ERR[e.code ?? ""] ?? "Could not complete the transfer." : "Could not complete the transfer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={step === "success" ? undefined : "Send money"} size="sm">
      {step === "success" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={52} className="text-success" strokeWidth={1.8} />
          <h3 className="font-display text-xl font-bold text-content">Money sent</h3>
          <p className="text-sm text-muted">
            <span className="font-bold text-content">{inr(amt)}</span> sent to {maskedRecipient}.
          </p>
          <button type="button" onClick={close} className="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white">
            Done
          </button>
        </div>
      ) : step === "otp" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-canvas p-3 text-sm dark:bg-charcoal/60">
            Sending <span className="font-bold text-content">{inr(amt)}</span> to{" "}
            <span className="font-bold text-content">{maskedRecipient}</span>
          </div>
          <label className="text-xs font-medium text-muted">
            Enter the OTP sent to your phone
            <input
              autoFocus
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              placeholder="6-digit OTP"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-lg font-bold tracking-widest text-content outline-none focus:border-emerald-500"
            />
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={otp.trim().length < 4 || busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Confirm &amp; send
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="text-xs font-medium text-muted">
            Send to (phone, email or referral code)
            <input
              autoFocus
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="+91… / name@email / CODE"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-content outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            Amount (₹)
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
              placeholder={`${MIN}–${MAX.toLocaleString("en-IN")}`}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-lg font-bold text-content outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            Note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              placeholder="What's it for?"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-content outline-none focus:border-emerald-500"
            />
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!formValid || busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {busy ? "Sending OTP…" : amt > 0 ? `Send ${inr(amt)}` : "Send money"}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={13} className="text-success" /> OTP-verified · instant to their wallet
          </p>
        </div>
      )}
    </Modal>
  );
}
