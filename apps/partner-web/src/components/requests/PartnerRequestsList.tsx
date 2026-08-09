"use client";

import { AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";
import { usePartnerBookingsQuery } from "@/hooks/use-partner-data";
import type { PartnerBooking } from "@/types/partner";

type Props = {
  limit?: number;
  status?: string;
  onAccepted?: () => void;
  Card: ComponentType<{ request: PartnerBooking; onAccepted?: () => void }>;
};

export function PartnerRequestsList({
  limit,
  status = "pending",
  onAccepted,
  Card,
}: Props) {
  const { data, isLoading, isError, refetch, isFetching } = usePartnerBookingsQuery({
    page: 1,
    limit: limit ?? 30,
    status,
    sortBy: "recent",
  });

  const items = data?.bookings ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-partner-line py-12 text-sm text-partner-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading requests…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-partner-danger/30 bg-partner-danger/10 p-4 text-center text-sm text-partner-danger">
        Couldn&apos;t load requests.
        <button
          type="button"
          onClick={() => void refetch()}
          className="ml-2 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-partner-line py-12 text-center text-sm text-partner-muted">
        Nothing here yet. Stay online to receive jobs.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {isFetching ? (
        <p className="text-[10px] text-partner-muted">Syncing latest…</p>
      ) : null}
      <AnimatePresence mode="popLayout">
        {items.map((req) => (
          <Card key={req.id} request={req} onAccepted={onAccepted} />
        ))}
      </AnimatePresence>
    </div>
  );
}
