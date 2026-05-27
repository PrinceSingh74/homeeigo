"use client";

import { AnimatePresence } from "framer-motion";
import { usePartnerStore } from "@/stores/partner-store";
import type { BookingRequest } from "@/lib/partner-data";
import type { ComponentType } from "react";

export function PartnerRequestsList({
  limit,
  Card,
}: {
  limit?: number;
  Card: ComponentType<{ request: BookingRequest }>;
}) {
  const requests = usePartnerStore((s) => s.requests);
  const list = limit ? requests.slice(0, limit) : requests;

  if (list.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-partner-line py-12 text-center text-sm text-partner-muted">
        No pending requests. Stay online to receive jobs.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {list.map((req) => (
          <Card key={req.id} request={req} />
        ))}
      </AnimatePresence>
    </div>
  );
}
