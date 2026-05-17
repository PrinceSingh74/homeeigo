"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServiceCardProps {
  icon: LucideIcon;
  name: string;
  price: string;
  color: string;
  featured?: boolean;
  index?: number;
}

export function ServiceCard({
  icon: Icon,
  name,
  price,
  color,
  featured = false,
  index = 0,
}: ServiceCardProps) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative flex h-50 w-40 shrink-0 snap-start flex-col items-center",
        "justify-center gap-3 overflow-hidden rounded-3xl border p-5 text-center",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/60 lg:w-44",
        featured
          ? "bg-premium border-transparent text-white shadow-glow-violet"
          : "bg-surface border-line text-content shadow-e3 hover:shadow-e4",
      )}
    >
      {featured && (
        <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-violet shadow-e1">
          Featured
        </span>
      )}
      <span
        className={cn(
          "grid size-14 place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-110",
          featured ? "bg-white/15" : "bg-primary/5",
        )}
      >
        <Icon
          size={30}
          strokeWidth={1.75}
          style={{ color: featured ? "#fff" : color }}
        />
      </span>
      <span className="font-display text-base font-semibold">{name}</span>
      <span
        className={cn(
          "text-sm font-medium",
          featured ? "text-white/90" : "text-muted",
        )}
      >
        From {price}
      </span>
    </motion.button>
  );
}
