"use client";

import { Check, Calendar, MapPin, ArrowRight } from "lucide-react";
import { m as motion } from "framer-motion";
import { Modal } from "@/components/ui/Modal";
import Link from "next/link";
import type { SavedBooking } from "@/lib/bookings";
import { BookingStatusBadge } from "@/components/booking/BookingStatusBadge";

export function BookingSuccessModal({
  open,
  onClose,
  booking,
  onViewBookings,
}: {
  open: boolean;
  onClose: () => void;
  booking: SavedBooking | null;
  onViewBookings?: () => void;
}) {
  if (!booking) return null;

  return (
    <Modal open={open} onClose={onClose} title="Booking confirmed!" size="md">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 12 }}
          className="grid size-16 place-items-center rounded-full bg-success text-white shadow-[0_0_32px_rgb(16_185_129/0.45)]"
        >
          <Check size={32} strokeWidth={3} />
        </motion.span>
        <div className="mt-4">
          <BookingStatusBadge status={booking.status} />
        </div>
        <p className="mt-3 font-mono text-sm font-bold text-emerald-600">{booking.id}</p>
        <p className="mt-2 font-display text-xl font-bold text-content">
          {booking.serviceTitle}
        </p>
        <p className="text-sm text-muted">
          {booking.packageName} · {booking.proName}
        </p>
      </motion.div>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl glass-card p-4 text-sm">
        <span className="flex items-center gap-2 text-content">
          <Calendar size={16} className="text-emerald-600" />
          {booking.dateLabel} · {booking.timeLabel}
        </span>
        <span className="flex items-start gap-2 text-content">
          <MapPin size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          {booking.address}
        </span>
        <span className="border-t border-line pt-3 font-display text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
          ₹{booking.total} payable at service
        </span>
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Track live, mark complete, or cancel anytime from My Bookings.
      </p>

      <div className="mt-6 flex flex-col gap-2">
        {onViewBookings ? (
          <button
            type="button"
            onClick={onViewBookings}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-sm font-bold text-white shadow-[0_10px_28px_-8px_rgb(16_185_129/0.55)]"
          >
            View My Bookings
            <ArrowRight size={16} />
          </button>
        ) : (
          <Link
            href="/bookings"
            onClick={onClose}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-sm font-bold text-white shadow-[0_10px_28px_-8px_rgb(16_185_129/0.55)]"
          >
            View My Bookings
            <ArrowRight size={16} />
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-11 text-sm font-semibold text-emerald-600 hover:underline"
        >
          Book another service
        </button>
      </div>
    </Modal>
  );
}
