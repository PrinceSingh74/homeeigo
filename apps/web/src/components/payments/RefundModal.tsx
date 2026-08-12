"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/buttons/Button";
import { Input } from "@/components/ui/Input";
import { useRefundSupportTicketMutation } from "@/hooks/use-core-data";

type RefundModalProps = {
  open: boolean;
  onClose: () => void;
  paymentId: string;
  maxAmount: number;
  defaultAmount?: number;
  onSuccess?: () => void;
};

const PRESET_REASONS = [
  "Service not delivered as agreed",
  "Provider cancelled",
  "Quality issue",
  "Wrong amount charged",
  "Duplicate payment",
];

export function RefundModal({
  open,
  onClose,
  paymentId,
  maxAmount,
  defaultAmount,
  onSuccess,
}: RefundModalProps) {
  const refundMutation = useRefundSupportTicketMutation();
  const [reason, setReason] = useState<string>("");
  const [customReason, setCustomReason] = useState<string>("");
  const [amount, setAmount] = useState<number>(defaultAmount ?? maxAmount);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setCustomReason("");
    setAmount(defaultAmount ?? maxAmount);
    setFormError(null);
  }, [open, defaultAmount, maxAmount]);

  const isCustom = reason === "__custom__";
  const finalReason = isCustom ? customReason.trim() : reason;
  const isSubmitting = refundMutation.isPending;

  async function handleSubmit() {
    if (!finalReason) {
      setFormError("Please select or enter a reason");
      return;
    }
    if (amount <= 0 || amount > maxAmount) {
      setFormError(`Amount must be between ₹1 and ₹${maxAmount}`);
      return;
    }
    setFormError(null);
    try {
      await refundMutation.mutateAsync({
        paymentId,
        reason: finalReason,
        amount,
      });
      onSuccess?.();
      onClose();
    } catch {
      /* toast already shown via mutation onError */
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request refund" size="md">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning/5 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-xs leading-relaxed text-muted">
            For eligible bookings, cancel from Bookings to get an automatic refund quote.
            This form opens a support ticket for payment disputes — our team responds within 24 hours.
          </div>
        </div>

        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Reason for refund
          </p>
          <div className="space-y-2">
            {PRESET_REASONS.map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                  reason === r
                    ? "border-primary bg-primary/5 text-content"
                    : "border-line bg-surface text-content hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="refund-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  disabled={isSubmitting}
                  className="size-4 accent-primary"
                />
                {r}
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                isCustom
                  ? "border-primary bg-primary/5 text-content"
                  : "border-line bg-surface text-content hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="refund-reason"
                value="__custom__"
                checked={isCustom}
                onChange={() => setReason("__custom__")}
                disabled={isSubmitting}
                className="size-4 accent-primary"
              />
              Other (describe)
            </label>
          </div>
          {isCustom ? (
            <textarea
              rows={2}
              value={customReason}
              maxLength={200}
              onChange={(e) => setCustomReason(e.target.value)}
              disabled={isSubmitting}
              placeholder="Tell us what went wrong"
              className="mt-2 w-full resize-none rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
            />
          ) : null}
        </section>

        <section>
          <Input
            label="Refund amount"
            type="number"
            inputMode="decimal"
            value={String(amount)}
            min={1}
            max={maxAmount}
            disabled={isSubmitting}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            helperText={`You can refund up to ₹${maxAmount.toLocaleString("en-IN")}`}
            showClear={false}
          />
        </section>

        {formError ? (
          <p className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            isLoading={isSubmitting}
            disabled={isSubmitting || amount <= 0 || amount > maxAmount}
          >
            Submit to support
          </Button>
        </div>
      </div>
    </Modal>
  );
}
