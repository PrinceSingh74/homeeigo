"use client";

import { motion } from "framer-motion";
import { Clock, MapPin, IndianRupee, User } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import type { BookingRequest } from "@/lib/partner-data";
import { usePartnerStore } from "@/stores/partner-store";
import { useRouter } from "next/navigation";

export function BookingRequestCard({ request }: { request: BookingRequest }) {
  const acceptRequest = usePartnerStore((s) => s.acceptRequest);
  const rejectRequest = usePartnerStore((s) => s.rejectRequest);
  const router = useRouter();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <PartnerCard
        className={
          request.urgency === "high"
            ? "border-partner-warning/40 ring-1 ring-partner-warning/20"
            : undefined
        }
      >
        {request.urgency === "high" && (
          <span className="mb-2 inline-block rounded-full bg-partner-warning/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-warning">
            High priority
          </span>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-partner-primary/20">
              <User className="h-5 w-5 text-partner-primary" />
            </div>
            <div>
              <p className="font-semibold">{request.customerName}</p>
              <p className="text-sm text-partner-muted">{request.serviceType}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-0.5 font-display text-xl font-bold text-partner-success">
              <IndianRupee className="h-4 w-4" />
              {request.earnings}
            </p>
            <p className="text-[10px] text-partner-muted">estimated</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">Distance</p>
            <p className="font-semibold">{request.distanceKm} km</p>
          </div>
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">ETA</p>
            <p className="flex items-center justify-center gap-0.5 font-semibold">
              <Clock className="h-3 w-3" />
              {request.etaMin}m
            </p>
          </div>
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">Posted</p>
            <p className="font-semibold">{request.createdAt}</p>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-sm text-partner-muted">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" />
          {request.address}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <PartnerButton
            variant="outline"
            className="w-full"
            onClick={() => rejectRequest(request.id)}
          >
            Decline
          </PartnerButton>
          <PartnerButton
            variant="success"
            className="w-full"
            onClick={() => {
              acceptRequest(request.id);
              router.push("/map");
            }}
          >
            Accept job
          </PartnerButton>
        </div>
      </PartnerCard>
    </motion.div>
  );
}
