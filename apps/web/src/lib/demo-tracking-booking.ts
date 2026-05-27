import type { SavedBooking } from "@/lib/bookings";
import { createInitialTimeline, patchTimeline } from "@/lib/bookings";

/** HOMIGO delivery rider asset (shared with home feature banner) */
export const HOMIGO_RIDER_IMAGE = "/rider.webp";

/** Demo live-tracking booking (bookings page) */
export const DEMO_TRACKING = {
  bookingRef: "HMG-2847",
  bookingId: "demo-hmg-2847",
  proName: "Ramesh Kumar",
  proPhone: "+919876543210",
  proRating: "4.8",
  serviceId: "ac-service" as const,
  serviceTitle: "AC Service",
  etaMins: 12,
  shareUrl: "https://homigo.app/track/HMG-2847",
};

export function createDemoTrackingBooking(now = new Date()): SavedBooking {
  const iso = now.toISOString();
  const timeline = patchTimeline(createInitialTimeline(iso), "in_progress", iso);
  return {
    id: DEMO_TRACKING.bookingId,
    serviceId: DEMO_TRACKING.serviceId,
    serviceTitle: DEMO_TRACKING.serviceTitle,
    serviceName: DEMO_TRACKING.serviceTitle,
    packageName: "Standard service",
    dateLabel: "Today",
    timeLabel: "In progress",
    address: "Home · Koramangala, Bengaluru",
    total: 499,
    status: "in_progress",
    createdAt: iso,
    updatedAt: iso,
    imagePath: "/svc-ac.png",
    serviceColor: "#38bdf8",
    proName: DEMO_TRACKING.proName,
    instructions: "AC not cooling — check gas & filter",
    timeline,
  };
}

export function ensureDemoTrackingBooking(
  bookings: SavedBooking[],
  addBooking: (b: SavedBooking) => void,
): SavedBooking {
  const existing = bookings.find((b) => b.id === DEMO_TRACKING.bookingId);
  if (existing) return existing;
  const demo = createDemoTrackingBooking();
  addBooking(demo);
  return demo;
}
