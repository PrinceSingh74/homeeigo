import type { BookingStatus } from "./store";

export type StatusConfig = {
  label: string;
  shortLabel: string;
  description: string;
  gradient: readonly [string, string, string];
  accent: string;
  bg: string;
  text: string;
  icon: "clock" | "truck" | "check" | "x";
};

export const STATUS_CONFIG: Record<BookingStatus, StatusConfig> = {
  confirmed: {
    label: "Booked",
    shortLabel: "Upcoming",
    description: "Your pro will arrive at the scheduled time",
    gradient: ["#2563EB", "#4F46E5", "#7C3AED"],
    accent: "#2563EB",
    bg: "rgba(37, 99, 235, 0.12)",
    text: "#1D4ED8",
    icon: "clock",
  },
  in_progress: {
    label: "On the way",
    shortLabel: "Live",
    description: "Your expert is heading to your location",
    gradient: ["#06B6D4", "#0EA5E9", "#2563EB"],
    accent: "#06B6D4",
    bg: "rgba(6, 182, 212, 0.14)",
    text: "#0E7490",
    icon: "truck",
  },
  completed: {
    label: "Completed",
    shortLabel: "Done",
    description: "Service finished — thank you for choosing HOMIGO",
    gradient: ["#059669", "#10B981", "#34D399"],
    accent: "#10B981",
    bg: "rgba(16, 185, 129, 0.14)",
    text: "#047857",
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
  return items.filter((b) => b.status === "cancelled");
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
    cancelled: items.filter((b) => b.status === "cancelled").length,
  };
}
