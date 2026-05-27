"use client";

import { BookingRequestCard } from "@/components/requests/BookingRequestCard";
import { PartnerRequestsList } from "@/components/requests/PartnerRequestsList";
import { usePartnerStore } from "@/stores/partner-store";
import { partnerLayout } from "@/lib/partner-layout";

export default function RequestsPage() {
  const online = usePartnerStore((s) => s.vendor.online);

  return (
    <div className={partnerLayout.pageStack}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-partner-text">
          Booking requests
        </h1>
        <p className="text-sm text-partner-text-secondary">
          {online
            ? "Accept jobs in your zone — first response wins."
            : "Go online to receive live requests."}
        </p>
      </div>
      <PartnerRequestsList Card={BookingRequestCard} />
    </div>
  );
}
