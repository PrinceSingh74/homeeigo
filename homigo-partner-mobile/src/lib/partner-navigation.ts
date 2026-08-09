import type { LucideIcon } from "lucide-react-native";
import {
  Award,
  BarChart3,
  Bell,
  Brain,
  Calendar,
  ClipboardList,
  Compass,
  Crown,
  FileCheck2,
  FileText,
  GraduationCap,
  HeartPulse,
  HelpCircle,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Navigation2,
  Route,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UserCheck2,
  Wallet,
} from "lucide-react-native";

export type PartnerNavItem = {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  badgeLabel?: string;
};

export type PartnerNavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: PartnerNavItem[];
};

/** Mirrors partner-web PARTNER_HQ_NAV — routes use /hq/[id] */
export const PARTNER_HQ_NAV: PartnerNavSection[] = [
  {
    id: "home",
    label: "Home",
    icon: LayoutDashboard,
    items: [{ id: "dashboard", label: "Dashboard", subtitle: "Live KPIs, requests, and performance", icon: LayoutDashboard }],
  },
  {
    id: "work",
    label: "Work HQ",
    icon: ClipboardList,
    items: [
      { id: "work-hq", label: "Live Status", subtitle: "Requests, active jobs, and session hours", icon: ClipboardList },
      { id: "requests", label: "Requests & Bookings", subtitle: "Accept, start, and complete jobs", icon: ClipboardList },
      { id: "route-center", label: "Route Center", subtitle: "Optimized multi-stop route with ETA", icon: Route },
      { id: "work-attendance", label: "Attendance", subtitle: "Check-in/out and shift history", icon: UserCheck2 },
      { id: "work-schedule", label: "Schedule", subtitle: "Online toggle and upcoming jobs", icon: Calendar },
      { id: "work-service-history", label: "Service History", subtitle: "Completed, cancelled, and upcoming mix", icon: FileText },
    ],
  },
  {
    id: "earnings",
    label: "Earnings HQ",
    icon: Wallet,
    items: [
      { id: "earnings-hq", label: "Overview", subtitle: "Today, week, month earnings snapshot", icon: Wallet },
      { id: "earnings-detail", label: "Earnings", subtitle: "Period analytics and breakdowns", icon: Wallet },
      { id: "wallet", label: "Wallet", subtitle: "Balance, withdraw, recent transactions", icon: Wallet },
      { id: "earnings-payouts", label: "Payouts", subtitle: "Withdrawal history and next payout", icon: FileText },
      { id: "earnings-incentives", label: "Incentives", subtitle: "Bonus rules and streak progress", icon: Award },
      { id: "earnings-tax", label: "Tax Center", subtitle: "GST, TDS, and FY tax summary", icon: FileCheck2 },
      { id: "earnings-forecast", label: "Forecast", subtitle: "Today, weekly, monthly projections", icon: Sparkles },
    ],
  },
  {
    id: "performance",
    label: "Performance HQ",
    icon: BarChart3,
    items: [
      { id: "performance-reviews", label: "Reviews", subtitle: "Customer ratings and responses", icon: Star },
      { id: "performance-scorecard", label: "Scorecard", subtitle: "Acceptance, completion, response metrics", icon: BarChart3 },
      { id: "performance-rankings", label: "Rankings", subtitle: "City, area, and category ranks", icon: Trophy },
      { id: "performance-quality", label: "Quality Insights", subtitle: "Automated quality recommendations", icon: Star },
      { id: "performance-analytics", label: "Analytics", subtitle: "Earnings and bookings charts", icon: BarChart3 },
    ],
  },
  {
    id: "ai",
    label: "AI HQ",
    icon: Brain,
    items: [
      { id: "ai-assistant", label: "AI Assistant", subtitle: "Smart insights from your dashboard", icon: Sparkles, badgeLabel: "Live" },
      { id: "ai-demand-forecast", label: "Demand Forecast", subtitle: "24h zone-hour demand predictions", icon: Sparkles },
      { id: "ai-route", label: "Route AI", subtitle: "AI route optimization summary", icon: Route },
      { id: "ai-intelligence", label: "Growth Advisor", subtitle: "Surge radar and zone ranking", icon: Brain },
    ],
  },
  {
    id: "territory",
    label: "Territory HQ",
    icon: MapPinned,
    items: [
      { id: "territory-navigation", label: "Navigation", subtitle: "Turn-by-turn job navigation", icon: Navigation2 },
      { id: "territory-heatmap", label: "Heatmap", subtitle: "Surge zones and demand overlay", icon: Compass },
      { id: "territory-coverage", label: "Coverage Areas", subtitle: "Provider density per zone", icon: MapPinned },
      { id: "territory-analytics", label: "Territory Analytics", subtitle: "Zone scoring and top territories", icon: MapPinned },
    ],
  },
  {
    id: "academy",
    label: "Partner Academy",
    icon: GraduationCap,
    items: [
      { id: "academy-training", label: "Training", subtitle: "Training modules and SOPs", icon: GraduationCap },
      { id: "academy-certifications", label: "Certifications", subtitle: "Earned certifications list", icon: Award },
    ],
  },
  {
    id: "trust",
    label: "Trust & Compliance",
    icon: ShieldCheck,
    items: [
      { id: "trust-documents", label: "Documents", subtitle: "Uploaded documents overview", icon: FileText },
      { id: "trust-verification", label: "Verification", subtitle: "KYC and background check status", icon: ShieldCheck },
      { id: "trust-compliance", label: "Compliance", subtitle: "Compliance score and expiry tracking", icon: FileCheck2 },
    ],
  },
  {
    id: "rewards",
    label: "Rewards HQ",
    icon: Crown,
    items: [
      { id: "rewards-hub", label: "Rewards", subtitle: "Badges, milestones, incentive earnings", icon: Crown },
      { id: "rewards-badges", label: "Badges", subtitle: "Achievement badges earned", icon: Award },
      { id: "rewards-referrals", label: "Referrals", subtitle: "Referral code and earnings", icon: Trophy },
    ],
  },
  {
    id: "wellbeing",
    label: "Wellbeing HQ",
    icon: HeartPulse,
    items: [
      { id: "wellbeing-insurance", label: "Insurance", subtitle: "Partner insurance portal", icon: HeartPulse },
      { id: "wellbeing-sos", label: "SOS", subtitle: "Emergency hotline and support", icon: HeartPulse },
      { id: "wellbeing-community", label: "Community", subtitle: "Partner community and announcements", icon: MessageSquare },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: Settings,
    items: [
      { id: "account-profile", label: "Profile", subtitle: "Business info, services, verification", icon: MessageSquare },
      { id: "account-notifications", label: "Notifications", subtitle: "Alerts, mark read, delete", icon: Bell },
      { id: "account-settings", label: "Settings", subtitle: "Account, security, availability", icon: Settings },
      { id: "account-support", label: "Help & Support", subtitle: "Support tickets and replies", icon: HelpCircle },
      { id: "account-membership", label: "Membership", subtitle: "Subscription plans and benefits", icon: Crown },
      { id: "account-invoices", label: "Invoices", subtitle: "Earnings invoices and settlements", icon: FileText },
      { id: "account-availability", label: "Availability", subtitle: "Go online / offline toggle", icon: UserCheck2 },
      { id: "account-map", label: "Live Map", subtitle: "Active jobs on map view", icon: MapPinned },
    ],
  },
];

export const HQ_SCREEN_IDS = new Set(
  PARTNER_HQ_NAV.flatMap((s) => s.items.map((i) => i.id)),
);

export function findNavItem(id: string) {
  for (const section of PARTNER_HQ_NAV) {
    const item = section.items.find((i) => i.id === id);
    if (item) return { section, item };
  }
  return null;
}
