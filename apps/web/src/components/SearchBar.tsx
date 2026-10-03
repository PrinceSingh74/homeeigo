"use client";

import { m as motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageSection } from "@/lib/page-layout";
import { Button } from "@/components/buttons/Button";
import { ServiceSearchInput } from "@/components/ServiceSearchInput";
import { useAppStore } from "@/stores/app-store";

/**
 * Home search group — the search field and the Quick Filters button share the
 * same control height (h-14) and radius so they read as one control row; the
 * row itself centres them vertically.
 */
export function SearchBar() {
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(pageSection, "-mt-4 sm:-mt-6")}
      aria-label="Find a service"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ServiceSearchInput />
        <Button
          type="button"
          variant="secondary"
          size="xl"
          icon={<SlidersHorizontal size={18} aria-hidden />}
          onClick={() => openOverlay("quick-filters")}
          className="w-full sm:w-auto sm:shrink-0"
        >
          Quick Filters
        </Button>
      </div>
    </motion.section>
  );
}
