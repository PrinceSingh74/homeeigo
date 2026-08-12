"use client";

import { m as motion } from "framer-motion";
import { Calendar, MapPin, ChevronRight } from "lucide-react";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import type { SavedBooking } from "@/lib/bookings";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { BookingStatusBadge } from "./BookingStatusBadge";

export function BookingCard({
  booking,
  index,
  onClick,
}: {
  booking: SavedBooking;
  index: number;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[booking.status];
  const cancelled = booking.status === "cancelled";
  const img = booking.imagePath;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, y: -12 }}
      transition={{
        duration: 0.55,
        delay: index * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -6, transition: { duration: 0.25 } }}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-[28px] border glass-card text-left outline-none",
        "transition-shadow duration-500 hover:shadow-[0_28px_64px_-16px_rgb(15_23_42/0.32)]",
        "focus-visible:ring-2 focus-visible:ring-primary/50",
        cancelled && "opacity-90",
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div
        className="h-1 w-full transition-all duration-700 group-hover:h-1.5"
        style={{ background: cfg.gradient }}
      />

      <div className="flex items-start justify-between gap-3 p-4 pb-3 sm:p-6 sm:pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold text-primary">
            {booking.id}
          </span>
          <BookingStatusBadge
            status={booking.status}
            live={booking.status === "in_progress"}
          />
        </div>
        <ChevronRight
          size={20}
          className="shrink-0 text-muted transition-transform duration-300 group-hover:translate-x-1 group-hover:text-primary"
        />
      </div>

      <div className="flex flex-col gap-4 px-4 pb-4 sm:flex-row sm:gap-5 sm:px-6 sm:pb-5">
        <div
          className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-white/40 sm:size-20"
          style={{
            background: `linear-gradient(135deg, ${booking.serviceColor}22, ${booking.serviceColor}08)`,
          }}
        >
          {img ? (
            <ServiceImage
              src={img}
              alt=""
              size={80}
              sizes="80px"
              className="size-16 drop-shadow-lg transition-transform duration-500 group-hover:scale-110 sm:size-20"
            />
          ) : (
            <span className="text-3xl">✂️</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="font-display text-xl font-bold tracking-tight text-content">
            {booking.serviceTitle}
          </h3>
          <p className="text-sm text-muted">
            {booking.packageName} · {booking.proName}
          </p>
          <p className="flex items-center gap-2 text-sm text-muted">
            <Calendar size={14} className="shrink-0 text-primary" />
            {booking.dateLabel} · {booking.timeLabel}
          </p>
          <p className="flex items-start gap-2 text-sm text-muted">
            <MapPin size={14} className="mt-0.5 shrink-0 text-primary" />
            <span className="line-clamp-1">{booking.address}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-6 py-4">
        <p className="text-xs font-semibold" style={{ color: cfg.text }}>
          {cfg.description}
        </p>
        <p className="font-display text-2xl font-bold text-aurora">
          {cancelled ? "—" : `₹${booking.total}`}
        </p>
      </div>
    </motion.article>
  );
}
