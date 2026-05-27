"use client";

import { motion } from "framer-motion";
import { Clock, MapPin } from "lucide-react";
import type { BookingRequest } from "@/lib/partner-data";
import { formatInr } from "@/lib/partner-data";
import { usePartnerStore } from "@/stores/partner-store";
import { useRouter } from "next/navigation";
export function DashboardRequestCard({
  request,
  index,
}: {
  request: BookingRequest;
  index: number;
}) {
  const acceptRequest = usePartnerStore((s) => s.acceptRequest);
  const rejectRequest = usePartnerStore((s) => s.rejectRequest);
  const router = useRouter();

  return (
    <motion.article
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35, ease: "easeOut" }}
      className="group grid gap-4 rounded-xl border border-partner-primary/20 bg-partner-primary/10 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-partner-primary hover:shadow-[0_4px_16px_rgb(37_99_235/0.18)] lg:grid-cols-[minmax(0,1fr)_200px_100px] lg:items-center lg:gap-6 lg:p-4"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border-2 border-partner-primary bg-partner-primary/15 text-sm font-bold text-partner-primary">
          {request.customerName.charAt(0)}
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-sm font-bold tracking-tight text-partner-text">
              {request.customerName}
            </p>
            {request.isNew && (
              <span className="rounded-md bg-partner-primary/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-primary">
                New
              </span>
            )}
          </div>
          <p className="text-xs leading-snug text-partner-text-secondary">
            {request.serviceType}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-partner-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{request.address}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-partner-primary/10 pt-3 lg:border-0 lg:pt-0">
        <div className="text-center lg:text-left">
          <p className="text-[10px] font-medium uppercase tracking-wide text-partner-muted">
            Distance
          </p>
          <p className="mt-0.5 text-xs font-semibold text-partner-text-secondary">
            {request.distanceKm} km
          </p>
        </div>
        <div className="text-center lg:text-left">
          <p className="text-[10px] font-medium uppercase tracking-wide text-partner-muted">
            Earning
          </p>
          <p className="mt-0.5 font-display text-sm font-bold text-partner-accent">
            {formatInr(request.earnings)}
          </p>
        </div>
        <div className="text-center lg:text-left">
          <p className="text-[10px] font-medium uppercase tracking-wide text-partner-muted">
            ETA
          </p>
          <p className="mt-0.5 flex items-center justify-center gap-0.5 text-xs font-semibold text-partner-text-secondary lg:justify-start">
            <Clock className="h-3 w-3" />
            {request.etaMin}m
          </p>
        </div>
      </div>

      <div className="flex gap-2 lg:flex-col lg:gap-2">
        <button
          type="button"
          onClick={() => {
            acceptRequest(request.id);
            router.push("/map");
          }}
          className="h-10 flex-1 rounded-lg bg-partner-success text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.97] lg:w-full"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => rejectRequest(request.id)}
          className="h-10 flex-1 rounded-lg border border-partner-danger text-xs font-semibold text-partner-danger transition hover:bg-partner-danger/10 active:scale-[0.97] lg:w-full"
        >
          Reject
        </button>
      </div>
    </motion.article>
  );
}
