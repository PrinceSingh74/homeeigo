"use client";

import { motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageSection } from "@/lib/page-layout";
import { ServiceSearchInput } from "@/components/ServiceSearchInput";
import { useAppStore } from "@/stores/app-store";

export function SearchBar() {
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(pageSection, "-mt-4 sm:-mt-6")}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <ServiceSearchInput />

        <motion.button
          type="button"
          onClick={() => openOverlay("quick-filters")}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          className={cn(
            "flex h-16 items-center justify-center gap-2 rounded-2xl glass-card px-7",
            "text-base font-semibold text-primary sm:w-auto",
            "transition-shadow hover:shadow-[0_16px_40px_-12px_rgb(15_23_42/0.25)]",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          )}
        >
          <SlidersHorizontal size={18} />
          Quick Filters
        </motion.button>
      </div>
    </motion.section>
  );
}
