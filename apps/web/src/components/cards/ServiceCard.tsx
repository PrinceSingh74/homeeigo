"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import { bookUrl } from "@/lib/booking-url";

export interface ServiceCardProps {
  serviceId: string;
  icon?: LucideIcon;
  img?: string;
  name: string;
  price: string;
  color: string;
  featured?: boolean;
  index?: number;
}

export function ServiceCard({
  serviceId,
  icon: Icon,
  img,
  name,
  price,
  color,
  featured = false,
  index = 0,
}: ServiceCardProps) {
  const router = useRouter();
  const reduce = useReducedMotion();

  return (
    <motion.button
      type="button"
      onClick={() => router.push(bookUrl({ service: serviceId }))}
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -10 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative flex h-[17.5rem] w-full min-w-0 flex-col items-center sm:h-80 lg:h-88",
        "justify-center gap-3 overflow-hidden rounded-[24px] p-4 text-center sm:gap-4 sm:rounded-[32px] sm:p-6",
        "outline-none transition-shadow duration-300 focus-visible:ring-2 focus-visible:ring-primary/60",
        featured
          ? "bg-premium text-white shadow-glow-violet"
          : "glass-card text-content hover:shadow-[0_24px_60px_-12px_rgb(15_23_42/0.28)]",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 sheen opacity-70"
      />

      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-16 left-1/2 size-44 -translate-x-1/2 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: featured ? "#a855f7" : color }}
      />

      {featured && (
        <span className="absolute right-4 top-4 z-10 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-violet shadow-e2 backdrop-blur">
          Featured
        </span>
      )}

      <span
        className={cn(
          "relative grid size-32 place-items-center overflow-hidden rounded-[24px] transition-transform duration-300 group-hover:scale-105 sm:size-40 sm:rounded-[30px] lg:size-44",
          featured
            ? "bg-white/15 ring-1 ring-white/30"
            : "ring-1 ring-white/50",
        )}
        style={
          featured
            ? undefined
            : {
                background: `linear-gradient(135deg, ${color}33 0%, ${color}14 60%, ${color}0A 100%)`,
                boxShadow: `inset 0 2px 6px rgb(255 255 255 / 0.6), 0 16px 32px -8px ${color}66`,
              }
        }
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 sheen"
        />
        {img ? (
          <ServiceImage
            src={img}
            alt={name}
            size={160}
            sizes="(max-width: 640px) 144px, 160px"
            className="relative size-36 drop-shadow-[0_14px_24px_rgb(15_23_42/0.34)] transition-transform duration-500 ease-out group-hover:scale-[1.18] sm:size-40"
          />
        ) : Icon ? (
          <Icon
            size={68}
            strokeWidth={1.75}
            className="transition-transform duration-500 group-hover:scale-[1.18]"
            style={{ color: featured ? "#fff" : color }}
          />
        ) : null}
      </span>

      <span className="relative font-display text-xl font-bold">{name}</span>
      <span
        className={cn(
          "relative text-base font-medium",
          featured ? "text-white/90" : "text-muted",
        )}
      >
        From {price}
      </span>
    </motion.button>
  );
}
