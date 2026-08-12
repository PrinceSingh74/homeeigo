const MOCK_BUSINESS_DATA_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true";

type ProfileFeatureIcon = "clock" | "users" | "gift" | "zap" | "headphones";
type ProfilePremiumFeature = { label: string; icon: ProfileFeatureIcon };

export const PROFILE_PREMIUM_FEATURES: ProfilePremiumFeature[] = MOCK_BUSINESS_DATA_ENABLED ? [
  { label: "Priority Booking", icon: "clock" },
  { label: "Elite Professionals", icon: "users" },
  { label: "Free Revisits", icon: "gift" },
  { label: "AI Optimization", icon: "zap" },
  { label: "Faster Support", icon: "headphones" },
] : [];

export const PROFILE_ADDRESSES = MOCK_BUSINESS_DATA_ENABLED ? [
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
] : [];

export const PROFILE_PAYMENT_ITEMS = MOCK_BUSINESS_DATA_ENABLED ? [
  { id: "cards", title: "Saved Cards", detail: "2 Cards" },
  { id: "upi", title: "UPI IDs", detail: "2 UPI IDs" },
  { id: "secure", title: "Secure Payments", detail: "100% Secure" },
  { id: "2fa", title: "Account Security", detail: "2FA Enabled" },
] : [];

export const PROFILE_SECURITY_ITEMS = MOCK_BUSINESS_DATA_ENABLED ? [
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
] : [];

export const PROFILE_SETTINGS = MOCK_BUSINESS_DATA_ENABLED ? [
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
] : [];

export const PROFILE_TRUST_CARDS = MOCK_BUSINESS_DATA_ENABLED ? [
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
] : [];


