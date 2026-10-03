import type { BookingStatus } from "./store";

export type StatusConfig = {
  label: string;
  shortLabel: string;
  description: string;
  gradient: readonly [string, string, string];
  accent: string;
  bg: string;
  text: string;
  icon: "clock" | "truck" | "check" | "x" | "timer-off" | "user-x" | "user-round-x";
};

export const STATUS_CONFIG: Record<BookingStatus, StatusConfig> = {
  confirmed: {
    label: "Booked",
    shortLabel: "Upcoming",
    description: "Your pro will arrive at the scheduled time",
    gradient: ["#0d9488", "#0f766e", "#065f46"],
    accent: "#0d9488",
    bg: "rgba(13, 148, 136, 0.12)",
    text: "#0f766e",
    icon: "clock",
  },
  in_progress: {
    label: "Live",
    shortLabel: "Live",
    description: "Your pro is en route or working on your service",
    gradient: ["#34d399", "#10b981", "#0d9488"],
    accent: "#10b981",
    bg: "rgba(16, 185, 129, 0.14)",
    text: "#047857",
    icon: "truck",
  },
  completed: {
    label: "Completed",
    shortLabel: "Done",
    description: "Service finished — thank you for choosing Homeeigo",
    gradient: ["#047857", "#059669", "#10B981"],
    accent: "#059669",
    bg: "rgba(5, 150, 105, 0.14)",
    text: "#065f46",
    icon: "check",
  },
  cancelled: {
    label: "Cancelled",
    shortLabel: "Cancelled",
    description: "This booking was cancelled",
    gradient: ["#64748B", "#94A3B8", "#CBD5E1"],
    accent: "#64748B",
    bg: "rgba(100, 116, 139, 0.14)",
    text: "#475569",
    icon: "x",
  },
  /** Same wording and colour as the web app: nobody cancelled it, the payment window closed. */
  expired: {
    label: "Payment time expired",
    shortLabel: "Expired",
    description: "Payment wasn't completed in time, so this slot was released",
    gradient: ["#B45309", "#D97706", "#F59E0B"],
    accent: "#D97706",
    bg: "rgba(217, 119, 6, 0.14)",
    text: "#B45309",
    icon: "timer-off",
  },
  /** Same wording as the web app (§77): the customer was not there when the professional arrived. */
  customer_no_show: {
    label: "Missed appointment",
    shortLabel: "Missed",
    description: "The professional arrived and waited, but nobody was available",
    gradient: ["#9A3412", "#C2410C", "#EA580C"],
    accent: "#C2410C",
    bg: "rgba(194, 65, 12, 0.12)",
    text: "#9A3412",
    icon: "user-x",
  },
  /** The professional did not arrive. The customer is never charged for this. */
  provider_no_show: {
    label: "Professional didn't arrive",
    shortLabel: "No-show",
    description: "The professional did not arrive — you have not been charged for this booking",
    gradient: ["#7F1D1D", "#B91C1C", "#DC2626"],
    accent: "#DC2626",
    bg: "rgba(220, 38, 38, 0.12)",
    text: "#B91C1C",
    icon: "user-round-x",
  },
};

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
  // The didn't-happen bucket, so an expired booking is never invisible; the row still says
  // "Payment time expired" rather than "Cancelled".
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
    cancelled: items.filter((b) => ["cancelled", "expired", "customer_no_show", "provider_no_show"].includes(b.status)).length,
  };
}
