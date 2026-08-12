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
    gradient: ["#0d9488", "#0f766e", "#065f46"],
    accent: "#0d9488",
    bg: "rgba(13, 148, 136, 0.12)",
    text: "#0f766e",
    icon: "clock",
  },
  in_progress: {
    label: "On the way",
    shortLabel: "Live",
    description: "Your expert is heading to your location",
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
