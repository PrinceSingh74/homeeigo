"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Mic, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchBar() {
  const [listening, setListening] = useState(false);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto -mt-6 max-w-content px-5 sm:px-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Search field */}
        <div
          className={cn(
            "group flex h-16 flex-1 items-center gap-3 rounded-2xl glass-card px-5 transition-all",
            "focus-within:shadow-[0_0_0_4px_rgb(37_99_235/0.14),0_16px_40px_-12px_rgb(15_23_42/0.25)]",
          )}
        >
          <Search size={22} className="shrink-0 text-muted" />
          <input
            type="text"
            placeholder="Search for a service…"
            aria-label="Search for a service"
            className="h-full w-full bg-transparent text-base text-content outline-none placeholder:italic placeholder:text-muted"
          />
          <motion.button
            type="button"
            onClick={() => setListening((v) => !v)}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.92 }}
            aria-label={listening ? "Stop voice search" : "Search by voice"}
            aria-pressed={listening}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
              listening
                ? "bg-pink/15 text-pink animate-pulse-glow"
                : "text-muted hover:text-primary",
            )}
          >
            <Mic size={20} />
          </motion.button>
        </div>

        {/* Quick filters */}
        <motion.button
          type="button"
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
