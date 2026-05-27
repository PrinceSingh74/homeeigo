import type { SavedBooking } from "@/lib/bookings";
import { createInitialTimeline } from "@/lib/bookings";

export const PROFILE_USER = {
  name: "Arjun Sharma",
  email: "arjun@homigo.app",
  status: "Premium Member",
  location: "Gurugram, Sector 49",
  memberSince: "Jan 2024",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&h=240&fit=crop&q=80",
  profileCompletion: 80,
  trustScore: 4.8,
  membership: "Premium",
};

export const PROFILE_QUICK_STATS = [
  {
    id: "wallet",
    label: "Wallet Balance",
    value: "₹2,450.75",
    link: "View Wallet",
    href: "/wallet",
    gradient: "from-violet to-primary",
  },
  {
    id: "bookings",
    label: "Active Bookings",
    value: "2",
    link: "View Bookings",
    href: "/bookings",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    id: "addresses",
    label: "Saved Addresses",
    value: "3",
    link: "Manage",
    action: "location" as const,
    gradient: "from-amber-500 to-orange-500",
  },
  {
    id: "referral",
    label: "Referral Earnings",
    value: "₹1,200",
    link: "Invite & Earn",
    action: "refer" as const,
    gradient: "from-pink to-violet",
    notify: true,
  },
];

export const PROFILE_PREMIUM_FEATURES = [
  { label: "Priority Booking", icon: "clock" },
  { label: "Elite Professionals", icon: "users" },
  { label: "Free Revisits", icon: "gift" },
  { label: "AI Optimization", icon: "zap" },
  { label: "Faster Support", icon: "headphones" },
] as const;

const now = new Date().toISOString();

export const PROFILE_DEMO_BOOKINGS: SavedBooking[] = [
  {
    id: "prof-ac-1",
    serviceId: "ac-deep",
    serviceTitle: "AC Deep Cleaning",
    serviceName: "AC Deep Cleaning",
    packageName: "Deep clean",
    dateLabel: "20 May 2025",
    timeLabel: "10:30 AM",
    address: "Home · Sector 49, Gurugram",
    total: 899,
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
    imagePath: "/svc-ac.png",
    serviceColor: "#38bdf8",
    proName: "Rahul Kumar",
    timeline: createInitialTimeline(now),
  },
  {
    id: "prof-sofa-1",
    serviceId: "sofa-deep",
    serviceTitle: "Sofa Deep Cleaning",
    serviceName: "Sofa Deep Cleaning",
    packageName: "3-seater",
    dateLabel: "12 May 2025",
    timeLabel: "2:00 PM",
    address: "Home · Sector 49, Gurugram",
    total: 649,
    status: "completed",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    imagePath: "/svc-sofa.png",
    serviceColor: "#a78bfa",
    proName: "Priya Singh",
    timeline: createInitialTimeline(now),
  },
];

export const PROFILE_INSIGHTS = [
  {
    id: "ac",
    title: "AC maintenance due in 7 days",
    description: "Keep your AC running at peak performance",
    icon: "snowflake",
    bg: "bg-[#EFF6FF] dark:bg-primary/10",
    border: "border-[#DBEAFE] dark:border-primary/20",
    iconBg: "bg-primary",
  },
  {
    id: "kitchen",
    title: "Kitchen deep cleaning recommended",
    description: "Based on your usage patterns",
    icon: "chef",
    bg: "bg-[#FEF3C7] dark:bg-amber-500/10",
    border: "border-[#FCD34D] dark:border-amber-500/30",
    iconBg: "bg-amber-500",
  },
  {
    id: "savings",
    title: "You saved ₹450 this month",
    description: "Great job! You're at 18% savings",
    icon: "trending",
    bg: "bg-[#D1FAE5] dark:bg-emerald-500/10",
    border: "border-[#A7F3D0] dark:border-emerald-500/30",
    iconBg: "bg-success",
  },
];

export const PROFILE_ADDRESSES = [
  {
    id: "home",
    type: "Home",
    tag: "Primary",
    line1: "A-201, Greenwood Residency, Sector 49",
    line2: "Gurugram, Haryana — 122018",
    badgeBg: "bg-[#EFF6FF] text-[#0C4A6E] dark:bg-primary/15 dark:text-primary",
  },
  {
    id: "office",
    type: "Office",
    tag: "Work",
    line1: "5, DLF Cyber City, Phase 2",
    line2: "Gurugram, Haryana — 122002",
    badgeBg: "bg-[#E0E7FF] text-[#3730A3] dark:bg-violet/15 dark:text-violet",
  },
  {
    id: "parents",
    type: "Secondary",
    tag: "",
    line1: "23, Park Avenue, Sector 28",
    line2: "Gurugram, Haryana — 122001",
    badgeBg: "bg-[#FCE7F3] text-[#BE185D] dark:bg-pink/15 dark:text-pink",
  },
];

export const PROFILE_PAYMENT_ITEMS = [
  { id: "cards", title: "Saved Cards", detail: "2 Cards" },
  { id: "upi", title: "UPI IDs", detail: "2 UPI IDs" },
  { id: "secure", title: "Secure Payments", detail: "100% Secure" },
  { id: "2fa", title: "Account Security", detail: "2FA Enabled" },
];

export const PROFILE_SECURITY_ITEMS = [
  {
    title: "Secure Payments",
    description: "Your payments are safe with us",
  },
  {
    title: "2FA Enabled",
    description: "Two-factor authentication active",
  },
  {
    title: "Account Verified",
    description: "Email & phone verified",
  },
  {
    title: "Fraud Detection",
    description: "Real-time fraud detection active",
  },
];

export const PROFILE_SETTINGS = [
  {
    id: "notifications",
    title: "Notification Settings",
    description: "Bookings, offers & pro updates",
    icon: "bell",
    color: "bg-primary",
    action: "toast" as const,
  },
  {
    id: "privacy",
    title: "Privacy & Security",
    description: "Password, 2FA & data",
    icon: "shield",
    color: "bg-violet",
    action: "settings" as const,
  },
  {
    id: "language",
    title: "Language",
    description: "English (India)",
    icon: "globe",
    color: "bg-success",
    action: "toast" as const,
  },
  {
    id: "help",
    title: "Help & Support",
    description: "Chat, call & FAQs",
    icon: "headphones",
    color: "bg-warning",
    action: "support" as const,
  },
  {
    id: "logout",
    title: "Logout",
    description: "Sign out of your account",
    icon: "logout",
    color: "bg-error",
    action: "logout" as const,
    danger: true,
  },
];

export const PROFILE_TRUST_CARDS = [
  {
    title: "Verified Customer",
    description: "Your account is verified",
    bg: "#ECFDF5",
    color: "#10B981",
    icon: "badge",
  },
  {
    title: "Secure Payments",
    description: "Your payments are safe with us",
    bg: "#EFF6FF",
    color: "#2563EB",
    icon: "lock",
  },
  {
    title: "Member Since 2024",
    description: "Trusted by thousands",
    bg: "#F5F3FF",
    color: "#7C3AED",
    icon: "calendar",
  },
  {
    title: "AI Protected",
    description: "Fraud detection active",
    bg: "#FFF7ED",
    color: "#F59E0B",
    icon: "shield",
  },
];

export const REFERRAL_CURRENT = 1200;
export const REFERRAL_TARGET = 2500;
