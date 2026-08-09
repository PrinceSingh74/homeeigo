"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerMeQuery, useSetOnlineMutation } from "@/hooks/use-partner-data";
import { cn } from "@/lib/cn";

export function OnlineToggle() {
  const me = usePartnerMeQuery();
  const setOnline = useSetOnlineMutation();
  const online = me.data?.isOnline ?? false;
  const isBusy = setOnline.isPending || me.isLoading;

  return (
    <PartnerCard className="flex flex-col items-center py-10 text-center">
      <p className="text-sm text-partner-muted">You are currently</p>
      <motion.p
        key={online ? "on" : "off"}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "font-display mt-2 text-3xl font-bold",
          online ? "text-partner-success" : "text-partner-muted",
        )}
      >
        {online ? "Available" : "Offline"}
      </motion.p>
      <button
        type="button"
        role="switch"
        aria-checked={online}
        disabled={isBusy}
        onClick={() => void setOnline.mutate(!online)}
        className={cn(
          "relative mt-8 h-16 w-32 rounded-full transition-colors",
          online ? "bg-partner-success/30" : "bg-partner-muted/20",
          isBusy && "opacity-70",
        )}
      >
        <motion.span
          layout
          className={cn(
            "absolute top-2 flex h-12 w-12 items-center justify-center rounded-full shadow-lg",
            online
              ? "left-[calc(100%-3.5rem)] bg-partner-success status-pulse"
              : "left-2 bg-partner-muted",
          )}
        >
          {setOnline.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          ) : null}
        </motion.span>
      </button>
      <p className="mt-6 max-w-xs text-sm text-partner-muted">
        {online
          ? "You will receive live booking requests in your service zones."
          : "Go online to start earning. You won't receive new requests while offline."}
      </p>
      {me.data?.onlineSince && online ? (
        <p className="mt-2 text-[11px] text-partner-muted-dim">
          Online since{" "}
          {new Date(me.data.onlineSince).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : null}
    </PartnerCard>
  );
}
