"use client";

import { useId } from "react";
import { Phone } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { CUSTOMER_CALL_UNAVAILABLE_NOTE, customerCallLabel } from "@/lib/customer-call";

/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number, and there is no masked-call relay yet. The control stays where partners expect it, disabled,
 * with the masked number and a pointer to the job chat. It never asks the API for a number to dial.
 */
export function CallCustomerButton({
  phoneMasked,
  className,
  variant = "outline",
}: {
  bookingId: string;
  phoneMasked?: string | null;
  className?: string;
  variant?: "primary" | "outline" | "ghost";
}) {
  const noteId = useId();
  return (
    <div className={className}>
      <PartnerButton
        type="button"
        variant={variant}
        disabled
        aria-disabled="true"
        aria-describedby={noteId}
        className="w-full"
        data-testid="call-customer-btn"
      >
        <Phone className="h-4 w-4" />
        {customerCallLabel(phoneMasked)}
      </PartnerButton>
      <p id={noteId} className="mt-1 text-[11px] text-partner-muted">{CUSTOMER_CALL_UNAVAILABLE_NOTE}</p>
    </div>
  );
}
