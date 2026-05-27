"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Calendar,
  User,
  MessageSquare,
  Navigation,
  XCircle,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import type { SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingTimeline } from "./BookingTimeline";
import { bookUrl } from "@/lib/booking-url";

export function BookingDetailModal({
  open,
  booking,
  onClose,
}: {
  open: boolean;
  booking: SavedBooking | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!booking) return null;

  const cfg = STATUS_CONFIG[booking.status];
  const img = booking.imagePath;
  const canTrack = booking.status === "confirmed";
  const canComplete =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canCancel =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canRebook =
    booking.status === "cancelled" || booking.status === "completed";

  function setStatus(status: SavedBooking["status"], message: string) {
    updateBookingStatus(booking!.id, status);
    showToast(message, "success");
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="" size="lg" className="!p-0 overflow-hidden">
        <div className="-mx-6 -mt-2">
          <div
            className="relative overflow-hidden px-6 pb-8 pt-10 text-white"
            style={{ background: cfg.gradient }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 backdrop-blur-sm transition hover:bg-white/30"
            >
              <X size={20} />
            </button>
            <div className="flex items-end gap-5">
              {img ? (
                <ServiceImage
                  src={img}
                  alt=""
                  size={96}
                  sizes="96px"
                  className="size-24 drop-shadow-2xl"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                <BookingStatusBadge status={booking.status} live />
                <h2 className="font-display text-2xl font-bold">{booking.serviceTitle}</h2>
                <p className="text-sm text-white/85">{cfg.description}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm font-bold text-primary">{booking.id}</span>
              <p className="font-display text-3xl font-bold text-content">
                ₹{booking.total}
                <span className="ml-1 text-sm font-medium text-muted">total</span>
              </p>
            </div>

            <div className="space-y-3 rounded-2xl glass-card p-4 text-sm">
              <DetailRow icon={Calendar} label="Schedule" value={`${booking.dateLabel} · ${booking.timeLabel}`} />
              <DetailRow icon={MapPin} label="Address" value={booking.address} />
              <DetailRow icon={User} label="Professional" value={booking.proName} />
              <DetailRow icon={MessageSquare} label="Package" value={`${booking.packageName} Package`} />
              {booking.instructions ? (
                <DetailRow icon={MessageSquare} label="Notes" value={booking.instructions} />
              ) : null}
            </div>

            <div>
              <h3 className="mb-3 font-display text-lg font-bold text-content">Status timeline</h3>
              <div className="rounded-2xl glass-card p-4">
                <BookingTimeline events={booking.timeline} />
              </div>
            </div>

            <div className="flex flex-col gap-2 pb-2">
              {canTrack && (
                <ActionBtn
                  primary
                  icon={Navigation}
                  label="Track live"
                  onClick={() => setStatus("in_progress", "Pro is on the way!")}
                />
              )}
              {canComplete && (
                <ActionBtn
                  icon={CheckCircle2}
                  label="Mark as completed"
                  onClick={() =>
                    setStatus("completed", "Thanks! Service marked complete")
                  }
                />
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-error transition hover:bg-error/10"
                >
                  <XCircle size={18} />
                  Cancel booking
                </button>
              )}
              {canRebook && (
                <ActionBtn
                  primary
                  icon={RotateCcw}
                  label="Book again"
                  onClick={() => {
                    onClose();
                    router.push(bookUrl({ service: booking.serviceId }));
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </Modal>

      <AnimatePresence>
        {cancelOpen && (
          <Modal
            open
            onClose={() => setCancelOpen(false)}
            title="Cancel booking?"
            size="sm"
          >
            <p className="text-sm text-muted">
              You won&apos;t be charged. You can book again anytime.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="h-12 rounded-2xl bg-surface text-sm font-bold text-content ring-1 ring-line"
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelOpen(false);
                  setStatus("cancelled", "Booking cancelled successfully");
                }}
                className="h-12 rounded-2xl bg-error/10 text-sm font-bold text-error"
              >
                Cancel booking
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-0.5 text-content">{value}</p>
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof Navigation;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold transition",
        primary
          ? "bg-aurora text-white shadow-glow-blue hover:brightness-110"
          : "glass-card text-primary hover:bg-primary/5",
      )}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}
