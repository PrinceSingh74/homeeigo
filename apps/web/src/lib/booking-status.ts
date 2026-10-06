import type { BookingStatus } from "@/lib/bookings";

export type StatusConfig = {
  label: string;
  shortLabel: string;
  description: string;
  gradient: string;
  accent: string;
  bg: string;
  text: string;
};

export const STATUS_CONFIG: Record<BookingStatus, StatusConfig> = {
  // The neutral pre-start wording, for when nothing more is known. What a pre-start booking
  // actually says is statusConfigFor's decision: awaiting payment, finding a professional, or
  // professional assigned.
  confirmed: {
    label: "Booked",
    shortLabel: "Booked",
    description: "We'll keep this booking updated as things change",
    gradient: "linear-gradient(135deg, #2563EB 0%, #4F46E5 50%, #7C3AED 100%)",
    accent: "#2563EB",
    bg: "rgb(37 99 235 / 0.12)",
    text: "#1D4ED8",
  },
  in_progress: {
    label: "Live",
    shortLabel: "Live",
    description: "Your pro is en route or working on your service",
    gradient: "linear-gradient(135deg, #06B6D4 0%, #0EA5E9 50%, #2563EB 100%)",
    accent: "#06B6D4",
    bg: "rgb(6 182 212 / 0.14)",
    text: "#0E7490",
  },
  completed: {
    label: "Completed",
    shortLabel: "Done",
    description: "Service finished — thank you for choosing HOMEEIGO",
    gradient: "linear-gradient(135deg, #059669 0%, #10B981 50%, #34D399 100%)",
    accent: "#10B981",
    bg: "rgb(16 185 129 / 0.14)",
    text: "#047857",
  },
  cancelled: {
    label: "Cancelled",
    shortLabel: "Cancelled",
    description: "This booking was cancelled",
    gradient: "linear-gradient(135deg, #64748B 0%, #94A3B8 100%)",
    accent: "#64748B",
    bg: "rgb(100 116 139 / 0.14)",
    text: "#475569",
  },
  /**
   * Distinct wording from "cancelled": nobody cancelled this booking — the payment window closed.
   * Amber rather than grey, because it is the one terminal state the customer can act on by
   * booking again.
   */
  expired: {
    label: "Payment time expired",
    shortLabel: "Expired",
    description: "Payment wasn't completed in time, so this slot was released",
    gradient: "linear-gradient(135deg, #B45309 0%, #F59E0B 100%)",
    accent: "#D97706",
    bg: "rgb(217 119 6 / 0.14)",
    text: "#B45309",
  },
  /** The customer was not there when the professional arrived; a capped fee was retained. */
  customer_no_show: {
    label: "Missed appointment",
    shortLabel: "Missed",
    description: "The professional arrived and waited, but nobody was available",
    gradient: "linear-gradient(135deg, #9A3412 0%, #EA580C 100%)",
    accent: "#C2410C",
    bg: "rgb(194 65 12 / 0.12)",
    text: "#9A3412",
  },
  /** The professional did not arrive. The customer is never charged for this. */
  provider_no_show: {
    label: "Professional didn't arrive",
    shortLabel: "No-show",
    description: "The professional did not arrive — you have not been charged for this booking",
    gradient: "linear-gradient(135deg, #7F1D1D 0%, #DC2626 100%)",
    accent: "#DC2626",
    bg: "rgb(220 38 38 / 0.12)",
    text: "#B91C1C",
  },
};

/**
 * The wording for a booking, true to where it really is.
 *
 * The presentation status "confirmed" covers every pre-start backend state, and it used to say
 * "Upcoming — your pro will arrive at the scheduled time" for all of them, including a booking
 * nobody had accepted and one that was not paid. The customer payload carries the real state
 * (`status`: pending until a professional accepts, then accepted / assigned; `paymentStatus`;
 * a provider name or null), so the three are told apart here. With neither known, the neutral
 * wording claims nothing about a professional.
 */
export function statusConfigFor(b: {
  status: BookingStatus;
  backendStatus?: string | null;
  paymentStatus?: string | null;
  proName?: string | null;
}): StatusConfig {
  const base = STATUS_CONFIG[b.status];
  if (b.status !== "confirmed") return base;
  const backend = (b.backendStatus ?? "").toLowerCase();
  const payment = (b.paymentStatus ?? "").toLowerCase();
  if (backend === "accepted" || backend === "assigned") {
    return {
      ...base,
      label: "Professional assigned",
      shortLabel: "Upcoming",
      description: "Your professional is assigned for the scheduled time",
    };
  }
  if (backend === "pending" && payment === "success") {
    return {
      ...base,
      label: "Finding a professional",
      shortLabel: "Finding a pro",
      description: "Payment received. We're finding a professional for your slot — their name appears here once one accepts",
    };
  }
  if (backend === "pending" && payment) {
    return {
      ...base,
      label: "Payment pending",
      shortLabel: "Awaiting payment",
      description: "Complete the payment to go ahead with this booking",
    };
  }
  return base;
}

export type BookingFilter = "all" | "upcoming" | "completed" | "cancelled";

export function filterBookings<T extends { status: BookingStatus }>(
  items: T[],
  filter: BookingFilter,
): T[] {
  if (filter === "all") return items;
  if (filter === "upcoming")
    return items.filter(
      (b) => b.status === "confirmed" || b.status === "in_progress",
    );
  if (filter === "completed")
    return items.filter((b) => b.status === "completed");
  // The "cancelled" tab is the didn't-happen bucket. An expired booking belongs there so it is
  // never invisible; the row itself still says "Payment time expired", not "Cancelled".
  return items.filter((b) => ["cancelled", "expired", "customer_no_show", "provider_no_show"].includes(b.status));
}

export function countByFilter<T extends { status: BookingStatus }>(
  items: T[],
): Record<BookingFilter, number> {
  return {
    all: items.length,
    upcoming: items.filter(
      (b) => b.status === "confirmed" || b.status === "in_progress",
    ).length,
    completed: items.filter((b) => b.status === "completed").length,
    // Counts must match what the tab shows, or the badge lies about how many rows are behind it.
    cancelled: items.filter((b) => ["cancelled", "expired", "customer_no_show", "provider_no_show"].includes(b.status)).length,
  };
}
