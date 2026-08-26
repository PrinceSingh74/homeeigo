export type BookingStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TimelineEvent = {
  id: string;
  label: string;
  at: string;
  done: boolean;
};

export type SavedBooking = {
  id: string;
  serviceId: string;
  serviceTitle: string;
  serviceName: string;
  packageName: string;
  dateLabel: string;
  timeLabel: string;
  address: string;
  total: number;
  /** Catalog snapshot of purchased add-ons ({id,name,price}) from the backend. */
  addons?: { id: string; name: string; price: number }[];
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  completedAt?: string;
  imagePath?: string;
  serviceColor: string;
  proName: string;
  instructions?: string;
  paymentStatus?: string;
  /** Raw backend status (pending/accepted/assigned/en_route/in_progress/…) — the
   *  UI status above collapses several of these, but live-tracking selection
   *  needs the real one to pick the booking a partner is actually riding for. */
  backendStatus?: string;
  timeline: TimelineEvent[];
};

export const SERVICE_IMAGES: Record<string, string> = {
  cleaning: "/svc-cleaning.png",
  "ac-service": "/svc-ac.png",
  plumbing: "/svc-plumbing.png",
  electrician: "/svc-electrician.png",
  "pest-control": "/svc-pest.png",
};

export function createInitialTimeline(
  now = new Date().toISOString(),
): TimelineEvent[] {
  return customerTimelineFromBackendStatus("pending", now);
}

/** Presentation collapse only — not a second customer FSM. */
export function collapseCustomerBookingStatus(raw: string | undefined): BookingStatus {
  const v = (raw ?? "").toLowerCase().replace(/-/g, "_");
  if (v === "completed") return "completed";
  if (v === "in_progress" || v === "en_route") return "in_progress";
  if (
    v === "rejected" ||
    v === "cancelled" ||
    v.includes("cancel")
  ) {
    return "cancelled";
  }
  return "confirmed";
}

/** Customer timeline derived from canonical backend status. */
export function customerTimelineFromBackendStatus(
  raw: string | undefined,
  now = new Date().toISOString(),
): TimelineEvent[] {
  const ui = collapseCustomerBookingStatus(raw);
  const v = (raw ?? "").toLowerCase().replace(/-/g, "_");
  if (ui === "cancelled") {
    return [
      { id: "1", label: "Booking confirmed", at: now, done: true },
      { id: "cancel", label: "Booking cancelled", at: now, done: true },
    ];
  }
  const assigned = ["accepted", "assigned", "en_route", "in_progress", "completed"].includes(v);
  const onTheWay = v === "en_route" || v === "in_progress" || v === "completed";
  const completed = v === "completed";
  return [
    { id: "1", label: "Booking confirmed", at: now, done: true },
    { id: "2", label: "Pro assigned", at: assigned ? now : "", done: assigned },
    { id: "3", label: "On the way", at: onTheWay ? now : "", done: onTheWay },
    { id: "4", label: "Service completed", at: completed ? now : "", done: completed },
  ];
}

export function patchTimeline(
  timeline: TimelineEvent[],
  status: BookingStatus,
  now: string,
): TimelineEvent[] {
  const t = timeline.map((e) => ({ ...e }));
  if (status === "confirmed") return t;
  if (status === "in_progress") {
    t[1] = { ...t[1], done: true, at: t[1].at || now };
    t[2] = { ...t[2], done: true, at: t[2].at || now };
    return t;
  }
  if (status === "completed") {
    return t.map((e) => ({ ...e, done: true, at: e.at || now }));
  }
  if (status === "cancelled") {
    return [
      ...t.slice(0, 1),
      { id: "cancel", label: "Booking cancelled", at: now, done: true },
    ];
  }
  return t;
}

/** Keep first occurrence per id (newest-first lists stay stable for React keys). */
export function dedupeBookingsById(bookings: SavedBooking[]): SavedBooking[] {
  const seen = new Set<string>();
  return bookings.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}
