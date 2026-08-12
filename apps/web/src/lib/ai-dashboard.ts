import {
  Activity,
  Building2,
  CalendarDays,
  Gift,
  Grid3X3,
  HelpCircle,
  Home,
  Mail,
  Settings,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export const AI_USER = {
  name: "Arjun Sharma",
  status: "Premium Member",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&h=240&fit=crop&q=80",
};

export type AiNavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export const AI_NAV: AiNavItem[] = [
  { id: "home", href: "/", label: "Home", icon: Home },
  { id: "bookings", href: "/bookings", label: "Bookings", icon: CalendarDays },
  { id: "ai", href: "/ai", label: "AI Assistant", icon: Sparkles },
  { id: "services", href: "/services", label: "Services", icon: Grid3X3 },
  { id: "wallet", href: "/wallet", label: "Wallet", icon: Wallet },
  { id: "homes", href: "/#homes", label: "Homes", icon: Building2 },
  { id: "offers", href: "/#offers", label: "Offers", icon: Gift },
  { id: "messages", href: "/#messages", label: "Messages", icon: Mail, badge: 5 },
  { id: "activity", href: "/#activity", label: "Activity", icon: Activity },
  { id: "help", href: "/#help", label: "Help Center", icon: HelpCircle },
  { id: "settings", href: "/#settings", label: "Settings", icon: Settings },
];

export const AI_HERO_STATS = [
  { id: "services", label: "Active Services", value: "12" },
  { id: "health", label: "Home Health Score", value: "95%" },
  { id: "optimizations", label: "AI Optimizations", value: "4" },
] as const;

export const AI_SMART_ACTIONS = [
  {
    id: "cleaning",
    title: "Book\nCleaning",
    gradient: "from-emerald-500 to-emerald-700",
    href: "/book?service=deep-cleaning",
  },
  {
    id: "ac",
    title: "Diagnose\nAC",
    gradient: "from-teal-400 to-teal-600",
    prompt: "AC cooling kam kar raha hai",
  },
  {
    id: "leak",
    title: "Detect\nLeakage",
    gradient: "from-teal-500 to-teal-700",
    prompt: "Check for water leakage in my home",
  },
  {
    id: "pest",
    title: "Pest\nScan",
    gradient: "from-teal-500 to-emerald-600",
    href: "/book?service=pest-control",
  },
  {
    id: "schedule",
    title: "Smart\nScheduling",
    gradient: "from-emerald-500 to-green-600",
    prompt: "Schedule my home services",
  },
  {
    id: "deep-clean",
    title: "AI Deep\nClean",
    gradient: "from-emerald-500 to-teal-500",
    href: "/book?service=deep-cleaning",
  },
] as const;

export type AiStatusTone = "success" | "info" | "warning" | "violet" | "cyan";

export type AiHomeStatusItem = {
  id: string;
  label: string;
  value: string;
  description: string;
  chip: string;
  tone: AiStatusTone;
  iconGradient: string;
  hoverGlow: string;
  valueColor: string;
  /** 0–100 for ring + bottom bar */
  progress?: number;
  trend?: string;
};

export const AI_HOME_STATUS: AiHomeStatusItem[] = [
  {
    id: "cleaning",
    label: "Cleaning Status",
    value: "Completed",
    description: "Today, 10:00 AM",
    chip: "Done",
    tone: "success",
    iconGradient: "from-emerald-400 to-teal-500",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(16_185_129/0.18)]",
    valueColor: "text-emerald-300",
    progress: 100,
  },
  {
    id: "ac",
    label: "AC Health",
    value: "92%",
    description: "Cooling efficiency",
    chip: "Excellent",
    tone: "info",
    iconGradient: "from-emerald-500 to-teal-600",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(37_99_235/0.18)]",
    valueColor: "text-emerald-300",
    progress: 92,
    trend: "+4% this week",
  },
  {
    id: "energy",
    label: "Energy Usage",
    value: "₹1,245",
    description: "This month",
    chip: "On track",
    tone: "warning",
    iconGradient: "from-amber-400 to-orange-500",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(245_158_11/0.18)]",
    valueColor: "text-amber-300",
    progress: 68,
    trend: "↓ 8% vs last mo.",
  },
  {
    id: "water",
    label: "Water Monitoring",
    value: "Normal",
    description: "No leakage detected",
    chip: "Stable",
    tone: "cyan",
    iconGradient: "from-cyan-400 to-teal-500",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(6_182_212/0.18)]",
    valueColor: "text-teal-300",
    progress: 100,
  },
  {
    id: "safety",
    label: "Home Safety",
    value: "Secure",
    description: "All systems active",
    chip: "Protected",
    tone: "success",
    iconGradient: "from-emerald-500 to-green-600",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(34_197_94/0.18)]",
    valueColor: "text-emerald-300",
    progress: 100,
  },
  {
    id: "optimization",
    label: "AI Optimization",
    value: "Active",
    description: "All systems optimal",
    chip: "AI Live",
    tone: "violet",
    iconGradient: "from-emerald-500 to-teal-500",
    hoverGlow: "hover:shadow-[0_12px_32px_rgb(124_58_237/0.2)]",
    valueColor: "text-teal-300",
    progress: 100,
    trend: "4 AI tips applied",
  },
];

export const AI_RECOMMENDED = {
  id: "ac-service",
  title: "AC General Service",
  image: "/svc-ac.png",
  rating: 4.8,
  reviews: "1.2k",
  provider: "Verified experts",
  tag: "Trending near you",
  price: 499,
  originalPrice: 799,
  href: "/book?service=ac-service",
} as const;

export const AI_INSIGHTS = [
  {
    id: "ac-maint",
    title: "AC Maintenance Due",
    description: "Your AC service is due in 7 days",
    cta: "Book Now",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/25",
    gradient: "from-emerald-500 to-teal-600",
  },
  {
    id: "bills",
    title: "Save on Bills",
    description: "Save up to ₹450 this month with AI optimization",
    cta: "Optimize Now",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/25",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    id: "water",
    title: "Water Usage",
    description: "Water usage is 18% lower than last month",
    bg: "bg-teal-400/10",
    border: "border-teal-400/25",
    gradient: "from-teal-400 to-teal-600",
  },
  {
    id: "cleaning",
    title: "Cleaning Reminder",
    description: "Deep cleaning recommended to keep your home healthy",
    cta: "Book Cleaning",
    bg: "bg-teal-400/10",
    border: "border-teal-400/25",
    gradient: "from-emerald-500 to-teal-500",
  },
] as const;

export const AI_PREDICTIONS = [
  { id: "deep", label: "Deep Cleaning", gradient: "from-teal-500 to-emerald-600" },
  { id: "filter", label: "Water Filter", gradient: "from-emerald-500 to-teal-600" },
  { id: "ac", label: "AC Service Due", gradient: "from-teal-400 to-teal-600" },
  { id: "pest", label: "Pest Control", gradient: "from-emerald-500 to-green-600" },
] as const;

export const AI_DEMO_MESSAGES = [
  {
    id: "ai-1",
    role: "assistant" as const,
    content: "Hello Arjun! 👋 How can I help you with your home today?",
    time: "05:30 PM",
    quickActions: ["Instant AI Diagnosis", "Book Expert", "Upload Photo"],
  },
  {
    id: "user-1",
    role: "user" as const,
    content: "AC cooling kam kar raha hai",
    time: "05:31 PM",
  },
  {
    id: "ai-2",
    role: "assistant" as const,
    content:
      "I've analyzed your AC performance and found possible airflow blockage. Would you like me to book an expert for inspection?",
    time: "05:31 PM",
    quickActions: ["Instant AI Diagnosis", "Book Expert", "Upload Photo"],
  },
];

export function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}
