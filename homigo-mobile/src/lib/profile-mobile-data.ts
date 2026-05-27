import type { LucideIcon } from "lucide-react-native";
import {
  Wallet,
  CalendarDays,
  MapPin,
  Coins,
  Gift,
  Users,
  Clock,
  UserCheck,
  RotateCcw,
  Zap,
} from "lucide-react-native";

export const PROFILE_USER = {
  name: "Arjun Sharma",
  status: "Premium Member",
  location: "Gurugram, Sector 49",
  memberSince: "Jan 2024",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&h=240&fit=crop&q=80",
  profileCompletion: 80,
  trustScore: 4.8,
  membership: "Premium",
};

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
  route?: "wallet" | "bookings" | "wallet-coins";
};

export const PROFILE_STAT_CARDS: ProfileStatCard[] = [
  {
    id: "wallet",
    label: "Wallet Balance",
    value: "₹2,450.75",
    link: "View Wallet",
    icon: Wallet,
    gradient: ["#7C3AED", "#2563EB"],
    route: "wallet",
  },
  {
    id: "bookings",
    label: "Active Bookings",
    value: "2",
    link: "View Bookings",
    icon: CalendarDays,
    gradient: ["#10B981", "#06B6D4"],
    linkColor: "#10B981",
    route: "bookings",
  },
  {
    id: "addresses",
    label: "Saved Addresses",
    value: "3",
    link: "Manage",
    icon: MapPin,
    gradient: ["#F59E0B", "#F97316"],
  },
  {
    id: "coins",
    label: "HOMIGO Coins",
    value: "320",
    link: "View Coins",
    icon: Coins,
    gradient: ["#D4AF37", "#F59E0B"],
    route: "wallet-coins",
  },
  {
    id: "rewards",
    label: "Rewards",
    value: "₹850",
    link: "View Rewards",
    icon: Gift,
    gradient: ["#EC4899", "#7C3AED"],
    route: "wallet",
  },
  {
    id: "referral",
    label: "Referral Earnings",
    value: "₹1,200",
    link: "Invite & Earn",
    icon: Users,
    gradient: ["#7C3AED", "#EC4899"],
  },
];

export const PROFILE_BOOKINGS = [
  {
    id: "p-ac",
    title: "AC Deep Cleaning",
    pro: "Rahul Kumar",
    rating: 4.9,
    date: "20 May 2025, 10:30 AM",
    status: "On the way" as const,
    statusBg: "#DBEAFE",
    statusColor: "#0C4A6E",
    action: "Track",
    imageKey: "ac" as const,
  },
  {
    id: "p-sofa",
    title: "Sofa Deep Cleaning",
    pro: "Priya Singh",
    rating: 4.8,
    date: "12 May 2025, 2:00 PM",
    status: "Completed" as const,
    statusBg: "#D1FAE5",
    statusColor: "#065F46",
    action: "Rebook",
    imageKey: "cleaning" as const,
  },
];

export const PROFILE_INSIGHTS = [
  {
    id: "ac",
    title: "AC maintenance due in 7 days",
    subtitle: "Keep your AC at peak performance",
    icon: "snowflake" as const,
    bg: "#EFF6FF",
    border: "#DBEAFE",
    iconBg: "#2563EB",
  },
  {
    id: "kitchen",
    title: "Kitchen deep cleaning recommended",
    subtitle: "Based on your usage patterns",
    icon: "brush" as const,
    bg: "#FEF3C7",
    border: "#FCD34D",
    iconBg: "#F59E0B",
  },
  {
    id: "savings",
    title: "You saved ₹450 this month",
    subtitle: "18% savings vs last month",
    icon: "wallet" as const,
    bg: "#D1FAE5",
    border: "#A7F3D0",
    iconBg: "#10B981",
  },
];

export const PROFILE_ADDRESSES = [
  {
    id: "home",
    type: "Home",
    tag: "Primary",
    line1: "A-201, Greenwood Residency",
    line2: "Sector 49, Gurugram",
    tagBg: "#EFF6FF",
    tagColor: "#0C4A6E",
  },
  {
    id: "office",
    type: "Office",
    tag: "Work",
    line1: "5, DLF Cyber City",
    line2: "Gurugram, Phase 2",
    tagBg: "#E0E7FF",
    tagColor: "#3730A3",
  },
  {
    id: "add",
    type: "add" as const,
  },
];
