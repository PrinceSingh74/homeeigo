"use client";

import { useSearchParams } from "next/navigation";
import { SupportCenter } from "@/components/support/SupportCenter";

export default function SupportPage() {
  const searchParams = useSearchParams();
  const initialTicketId = searchParams.get("ticket");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Help & Support</h1>
        <p className="text-sm text-partner-muted">
          Create tickets, track SLA status, and chat with HOMEEIGO support
        </p>
      </div>
      <SupportCenter initialTicketId={initialTicketId} />
    </div>
  );
}
