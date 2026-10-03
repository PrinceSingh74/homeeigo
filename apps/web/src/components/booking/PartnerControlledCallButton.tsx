"use client";

import { useState } from "react";
import { Phone, Loader2 } from "lucide-react";
import { coreApi } from "@/services/core/api";
import { cn } from "@/lib/utils";

/**
 * Controlled customer→partner dial via POST /api/bookings/:id/partner-call.
 * Never embeds raw partner phone in the DOM (no tel:/sms: from booking payloads).
 */
export function PartnerControlledCallButton({
  bookingId,
  partnerName,
  className,
  size = "md",
}: {
  bookingId: string;
  partnerName?: string | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);

  const onCall = async () => {
    if (!bookingId || busy) return;
    setBusy(true);
    try {
      const data = await coreApi.bookings.partnerCall(bookingId);
      if (data?.dialUri) {
        window.location.href = data.dialUri;
      }
    } catch {
      /* surfaced by disabled state / no-op — call gated by status */
    } finally {
      setBusy(false);
    }
  };

  const dim = size === "sm" ? "size-9" : "size-11";

  return (
    <button
      type="button"
      onClick={() => void onCall()}
      disabled={busy}
      aria-label={`Call ${partnerName?.trim() || "professional"}`}
      title={`Call ${partnerName?.trim() || "professional"}`}
      className={cn(
        "grid place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30 transition hover:brightness-110 active:scale-95 disabled:opacity-60",
        dim,
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone size={size === "sm" ? 15 : 18} />}
    </button>
  );
}
