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
  confirmed: {
    label: "Booked",
    shortLabel: "Upcoming",
    description: "Your pro will arrive at the scheduled time",
    gradient: "linear-gradient(135deg, #2563EB 0%, #4F46E5 50%, #7C3AED 100%)",
    accent: "#2563EB",
    bg: "rgb(37 99 235 / 0.12)",
    text: "#1D4ED8",
  },
  in_progress: {
    label: "On the way",
    shortLabel: "Live",
    description: "Your expert is heading to your location",
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
