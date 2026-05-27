"use client";

import { motion } from "framer-motion";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerStore } from "@/stores/partner-store";
import { cn } from "@/lib/cn";

export function OnlineToggle() {
  const online = usePartnerStore((s) => s.vendor.online);
  const setOnline = usePartnerStore((s) => s.setOnline);

  return (
    <PartnerCard className="flex flex-col items-center py-10 text-center">
      <p className="text-sm text-partner-muted">You are currently</p>
      <motion.p
        key={online ? "on" : "off"}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "font-display mt-2 text-3xl font-bold",
          online ? "text-partner-success" : "text-partner-muted"
        )}
      >
        {online ? "Available" : "Offline"}
      </motion.p>
      <button
        type="button"
        role="switch"
        aria-checked={online}
        onClick={() => setOnline(!online)}
        className={cn(
          "relative mt-8 h-16 w-32 rounded-full transition-colors",
          online ? "bg-partner-success/30" : "bg-partner-muted/20"
        )}
      >
        <motion.span
          layout
          className={cn(
            "absolute top-2 h-12 w-12 rounded-full shadow-lg",
            online
              ? "left-[calc(100%-3.5rem)] bg-partner-success status-pulse"
              : "left-2 bg-partner-muted"
          )}
        />
      </button>
      <p className="mt-6 max-w-xs text-sm text-partner-muted">
        {online
          ? "You will receive live booking requests in your service zones."
          : "Go online to start earning. You won't receive new requests while offline."}
      </p>
    </PartnerCard>
  );
}
