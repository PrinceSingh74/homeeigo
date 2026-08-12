"use client";

import { useState } from "react";
import { Gift, Loader2, Ticket } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  useGiftCardPurchase,
  useGiftDenominations,
  useMyGiftCards,
  useRedeemGiftCard,
  useVoidGiftCard,
} from "@/hooks/use-giftcards";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function GiftCardsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"buy" | "mine">("buy");
  const { data: denoms } = useGiftDenominations();
  const { data: cards } = useMyGiftCards(open);
  const { purchase, busy } = useGiftCardPurchase();
  const redeem = useRedeemGiftCard();
  const voidCard = useVoidGiftCard();

  const [amount, setAmount] = useState(500);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const buy = () => {
    void purchase(amount, { recipientEmail: recipientEmail.trim() || undefined, message: message.trim() || undefined }, () => {
      setTab("mine");
    });
  };

  const doRedeem = async () => {
    if (redeemCode.trim().length < 4 || redeeming) return;
    setRedeeming(true);
    const partial = Number(redeemAmount) > 0 ? Number(redeemAmount) : undefined;
    const ok = await redeem(redeemCode.trim(), partial);
    if (ok) {
      setRedeemCode("");
      setRedeemAmount("");
    }
    setRedeeming(false);
  };

  const doVoid = async (id: string) => {
    if (voidingId) return;
    setVoidingId(id);
    await voidCard(id);
    setVoidingId(null);
  };

  return (
    <Modal open={open} onClose={onClose} title="Gift cards" size="sm">
      <div className="mb-4 flex gap-1 rounded-xl bg-canvas p-1 dark:bg-charcoal/60">
        {(["buy", "mine"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-sm font-semibold transition",
              tab === t ? "bg-surface text-content shadow-sm" : "text-muted",
            )}
          >
            {t === "buy" ? "Buy a card" : "My cards"}
          </button>
        ))}
      </div>

      {tab === "buy" ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Choose amount</p>
            <div className="flex flex-wrap gap-2">
              {(denoms ?? [100, 250, 500, 1000, 2000]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setAmount(d)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-semibold transition",
                    amount === d ? "border-emerald-500 bg-emerald-600 text-white" : "border-line text-emerald-600 hover:bg-emerald-600/5",
                  )}
                >
                  {inr(d)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white">
            <Gift size={26} className="text-gold" />
            <p className="mt-2 font-display text-2xl font-bold">{inr(amount)}</p>
            <p className="text-xs text-white/80">HOMEEIGO Gift Card</p>
          </div>

          <label className="text-xs font-medium text-muted">
            Send to (email) — optional
            <input
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="friend@email.com (leave blank to keep)"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-content outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            Message — optional
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 200))}
              placeholder="Happy birthday!"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-content outline-none focus:border-emerald-500"
            />
          </label>

          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Buy {inr(amount)} gift card
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Redeem */}
          <div className="rounded-xl border border-line p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-content">
              <Ticket size={14} className="text-emerald-600" /> Redeem a gift card
            </p>
            <div className="flex gap-2">
              <input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                placeholder="HG-XXXX-XXXX-XXXX"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono text-content outline-none focus:border-emerald-500"
              />
              <input
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                placeholder="₹ all"
                inputMode="numeric"
                className="w-20 shrink-0 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-content outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => void doRedeem()}
                disabled={redeemCode.trim().length < 4 || redeeming}
                className="shrink-0 rounded-lg bg-success px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {redeeming ? "…" : "Redeem"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Leave amount blank to redeem the full balance, or enter an amount for partial.</p>
          </div>

          {/* My cards */}
          {!cards || cards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-muted">
              No gift cards yet. Buy one or redeem a code.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {cards.map((card) => (
                <li key={card.id} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-semibold text-content">{card.code}</p>
                    <p className="text-[11px] text-muted">
                      {card.role === "purchased" ? "Purchased" : "Received"}
                      {card.recipient ? ` · to ${card.recipient}` : ""}
                    </p>
                    {card.role === "purchased" && card.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => void doVoid(card.id)}
                        disabled={voidingId === card.id}
                        className="mt-1 text-[11px] font-semibold text-error hover:underline disabled:opacity-50"
                      >
                        {voidingId === card.id ? "Refunding…" : "Void & refund"}
                      </button>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-sm font-bold text-content">{inr(card.balance)}</p>
                    {card.balance !== card.amount && (
                      <p className="text-[10px] text-muted">of {inr(card.amount)}</p>
                    )}
                    <span
                      className={cn(
                        "mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase",
                        card.status === "ACTIVE" ? "bg-success/15 text-success" : "bg-line/60 text-muted",
                      )}
                    >
                      {card.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
