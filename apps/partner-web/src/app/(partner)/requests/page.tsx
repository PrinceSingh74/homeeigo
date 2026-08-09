"use client";

import { useState } from "react";
import { BookingRequestCard } from "@/components/requests/BookingRequestCard";
import { PartnerRequestsList } from "@/components/requests/PartnerRequestsList";
import { usePartnerMeQuery } from "@/hooks/use-partner-data";
import { partnerLayout } from "@/lib/partner-layout";

type Tab = "pending" | "active" | "completed";

const TABS: { id: Tab; label: string; description: string }[] = [
  {
    id: "pending",
    label: "New requests",
    description: "Accept jobs in your zone — first response wins.",
  },
  {
    id: "active",
    label: "Active",
    description: "Jobs you've accepted — start when you arrive at the customer.",
  },
  {
    id: "completed",
    label: "Completed",
    description: "Recent finished jobs and earnings credited to your wallet.",
  },
];

export default function RequestsPage() {
  const me = usePartnerMeQuery();
  const online = me.data?.isOnline ?? false;
  const [tab, setTab] = useState<Tab>("pending");
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className={partnerLayout.pageStack}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-partner-text">
          Bookings
        </h1>
        <p className="text-sm text-partner-text-secondary">
          {!online && tab === "pending"
            ? "Go online to receive live requests."
            : current.description}
        </p>
      </div>

      <div className="flex gap-1.5 rounded-xl border border-partner-line bg-partner-bg/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              tab === t.id
                ? "bg-partner-primary/20 text-partner-primary"
                : "text-partner-muted hover:text-partner-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PartnerRequestsList
        status={tab}
        Card={BookingRequestCard}
        onAccepted={tab === "pending" ? () => setTab("active") : undefined}
      />
    </div>
  );
}
