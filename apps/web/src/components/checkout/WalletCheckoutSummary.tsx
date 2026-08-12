"use client";

import { useMemo, useState } from "react";
import { useCheckoutQuote, useWalletCheckout } from "@/hooks/use-wallet-checkout";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  idle: { text: "", cls: "" },
  pending: { text: "PENDING", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  processing: { text: "PROCESSING", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  success: { text: "SUCCESS", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed: { text: "FAILED", cls: "bg-red-50 text-red-700 border-red-200" },
};

/**
 * Phase 18.4 — customer checkout summary. Live breakdown of Booking Amount / Taxes /
 * Wallet Usage / Card-UPI (Razorpay) / Final Total, with a "Use wallet balance" toggle.
 * Pays via the certified wallet-checkout endpoints (wallet-only / split / Razorpay-only).
 */
export function WalletCheckoutSummary({
  bookingId,
  description,
  onPaid,
}: {
  bookingId: string;
  description?: string;
  onPaid?: () => void;
}) {
  const { data: quote, isLoading, isError, refetch } = useCheckoutQuote(bookingId);
  const { pay, status } = useWalletCheckout();
  const [useWallet, setUseWallet] = useState(true);

  const breakdown = useMemo(() => {
    if (!quote) return null;
    const walletUsed = useWallet ? quote.walletApplicable : 0;
    const cardUsed = Math.max(0, quote.finalAmount - walletUsed);
    return { walletUsed, cardUsed };
  }, [quote, useWallet]);

  if (isLoading) return <div className="rounded-2xl border p-6 text-sm text-gray-500">Loading checkout…</div>;
  if (isError || !quote)
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Could not load checkout.{" "}
        <button onClick={() => refetch()} className="underline">
          Retry
        </button>
      </div>
    );

  const badge = STATUS_LABEL[status];
  const isPaid = quote.alreadyPaid || status === "success";
  const busy = status === "processing" || status === "pending";

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Payment Summary</h2>
        {badge?.text && <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>}
      </div>

      <div className="space-y-2.5 text-sm">
        <Row label="Booking Amount" value={inr(quote.bookingAmount - quote.taxes)} />
        {quote.taxes > 0 && <Row label="Taxes" value={inr(quote.taxes)} />}
        {breakdown && breakdown.walletUsed > 0 && <Row label="Wallet Usage" value={`− ${inr(breakdown.walletUsed)}`} accent="text-emerald-600" />}
        {breakdown && breakdown.cardUsed > 0 && <Row label="Card / UPI (Razorpay)" value={inr(breakdown.cardUsed)} />}
        <div className="my-2 border-t" />
        <Row label="Final Total" value={inr(quote.finalAmount)} bold />
      </div>

      {/* Wallet toggle */}
      <button
        type="button"
        onClick={() => setUseWallet((v) => !v)}
        disabled={quote.walletBalance <= 0 || isPaid || busy}
        className="mt-4 flex w-full items-center justify-between rounded-xl border p-3 text-left transition disabled:opacity-50"
      >
        <span className="flex items-center gap-3">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded border ${useWallet ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300"}`}
            aria-hidden
          >
            {useWallet ? "✓" : ""}
          </span>
          <span className="text-sm font-medium text-gray-800">Use Wallet Balance</span>
        </span>
        <span className="text-sm text-gray-500">{inr(quote.walletBalance)} available</span>
      </button>

      <button
        type="button"
        disabled={isPaid || busy}
        onClick={() =>
          pay({
            bookingId,
            useWallet,
            walletApplicable: quote.walletApplicable,
            fullyPayableFromWallet: quote.fullyPayableFromWallet,
            description,
            onSuccess: onPaid,
          })
        }
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 font-semibold text-white transition hover:bg-black disabled:opacity-50"
      >
        {isPaid
          ? "Paid"
          : busy
            ? status === "pending"
              ? "Resume Payment"
              : "Processing…"
            : breakdown && breakdown.cardUsed === 0
              ? `Pay ${inr(quote.finalAmount)} from Wallet`
              : `Pay ${inr(quote.finalAmount)}`}
      </button>

      {status === "failed" && <p className="mt-2 text-center text-xs text-red-600">Payment failed — you can retry.</p>}
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-gray-900" : "text-gray-600"}>{label}</span>
      <span className={`${bold ? "text-base font-bold text-gray-900" : accent ?? "text-gray-900"}`}>{value}</span>
    </div>
  );
}
