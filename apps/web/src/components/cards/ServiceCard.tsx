"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServiceCardProps {
  icon?: LucideIcon;
  img?: string;
  name: string;
  price: string;
  color: string;
  featured?: boolean;
  index?: number;
}

export function ServiceCard({
  icon: Icon,
  img,
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
        "group relative flex h-72 w-full flex-col items-center sm:h-80",
        "justify-center gap-4 overflow-hidden rounded-[28px] border p-6 text-center",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        featured
          ? "bg-premium border-transparent text-white shadow-glow-violet"
          : "bg-surface border-line text-content shadow-e3 hover:shadow-e4",
      )}
    >
      {featured && (
        <span className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-violet shadow-e1">
          Featured
        </span>
      )}
      <span
        className={cn(
          "grid size-32 place-items-center rounded-[26px] transition-transform duration-300 group-hover:scale-110 sm:size-36",
          featured ? "bg-white/15" : "",
        )}
        style={
          featured
            ? undefined
            : {
                background: `linear-gradient(135deg, ${color}26 0%, ${color}0F 100%)`,
              }
        }
      >
        {img ? (
          <img
            src={img}
            alt={name}
            className="size-28 object-contain drop-shadow-xl sm:size-32"
            loading="lazy"
          />
        ) : Icon ? (
          <Icon
            size={56}
            strokeWidth={1.75}
            style={{ color: featured ? "#fff" : color }}
          />
        ) : null}
      </span>
      <span className="font-display text-xl font-bold">{name}</span>
      <span
        className={cn(
          "text-base font-medium",
          featured ? "text-white/90" : "text-muted",
        )}
      >
        From {price}
      </span>
    </motion.button>
  );
}
