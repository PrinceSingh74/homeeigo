"use client";

import { MapPin, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useAppStore } from "@/stores/app-store";
import { getLocation } from "@/lib/services";
import { cn } from "@/lib/utils";

type LocationButtonProps = {
  compact?: boolean;
  className?: string;
};

export function LocationButton({ compact, className }: LocationButtonProps) {
  const locationId = useAppStore((s) => s.locationId);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const loc = getLocation(locationId);
  const label = compact ? loc.city : loc.label;

  return (
    <motion.button
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => openOverlay("location")}
      className={cn(
        "group flex h-9 max-w-full shrink-0 items-center justify-center gap-1 rounded-full border border-line bg-surface text-sm shadow-e1 transition-colors hover:bg-primary/5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        "w-9 px-0 sm:w-auto sm:max-w-[7.5rem] sm:justify-start sm:gap-1.5 sm:px-2.5 md:max-w-[9.5rem] lg:max-w-none lg:px-3",
        className,
      )}
      aria-label={`Location: ${loc.label}. Tap to change`}
    >
      <MapPin size={16} className="shrink-0 text-primary" aria-hidden />
      <span className="hidden min-w-0 truncate font-medium text-content sm:inline">
        {label}
      </span>
      <ChevronDown
        size={14}
        className="hidden shrink-0 text-muted transition-transform group-hover:translate-y-0.5 sm:block"
        aria-hidden
      />
    </motion.button>
  );
}
