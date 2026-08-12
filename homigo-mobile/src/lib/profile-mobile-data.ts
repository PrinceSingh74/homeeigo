import type { LucideIcon } from "lucide-react-native";
import {
  Wallet,
  CalendarDays,
  MapPin,
  Clock,
  UserCheck,
  RotateCcw,
  Zap,
} from "lucide-react-native";

// Premium feature chips — pure presentational marketing content (no business data).
export const PROFILE_PREMIUM_FEATURES = [
  { label: "Priority Booking", icon: Clock },
  { label: "Elite Pros", icon: UserCheck },
  { label: "Free Revisits", icon: RotateCcw },
  { label: "AI Optimize", icon: Zap },
] as const;

export type ProfileStatCard = {
  id: string;
  label: string;
  value: string;
  link: string;
  icon: LucideIcon;
  gradient: readonly [string, string];
  linkColor?: string;
  route?: "wallet" | "bookings" | "addresses";
};

// Card templates only. Every `value` shown is injected from the backend in
// ProfileQuickStatsGrid (wallet balance, active bookings, saved addresses).
// Gamification stats without a backend source (coins/rewards/referral) are
// intentionally omitted so the UI never shows fabricated numbers.
export const PROFILE_STAT_CARDS: ProfileStatCard[] = [
  {
    id: "wallet",
    label: "Wallet Balance",
    value: "0",
    link: "View Wallet",
    icon: Wallet,
    gradient: ["#7C3AED", "#2563EB"],
    route: "wallet",
  },
  {
    id: "bookings",
    label: "Active Bookings",
    value: "0",
    link: "View Bookings",
    icon: CalendarDays,
    gradient: ["#10B981", "#06B6D4"],
    linkColor: "#10B981",
    route: "bookings",
  },
  {
    id: "addresses",
    label: "Saved Addresses",
    value: "0",
    link: "Manage",
    icon: MapPin,
    gradient: ["#F59E0B", "#F97316"],
    route: "addresses",
  },
];
