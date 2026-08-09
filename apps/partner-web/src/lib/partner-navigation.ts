import type { LucideIcon } from "lucide-react";
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
} from "lucide-react";

export type PartnerNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeLabel?: string;
};

export type PartnerNavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: PartnerNavItem[];
};

/** Enterprise HQ navigation — grouped like Uber Partner / Linear sidebar IA. */
export const PARTNER_HQ_NAV: PartnerNavSection[] = [
  {
    id: "home",
    label: "Home",
    icon: LayoutDashboard,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    id: "work",
    label: "Work HQ",
    icon: ClipboardList,
    items: [
      { href: "/work-hq", label: "Live Status", icon: ClipboardList },
      { href: "/requests", label: "Requests", icon: ClipboardList },
      { href: "/requests", label: "Bookings", icon: Calendar },
      { href: "/route-center", label: "Route Center", icon: Route },
      { href: "/work-hq/attendance", label: "Attendance", icon: UserCheck2 },
      { href: "/work-hq/schedule", label: "Schedule", icon: Calendar },
      { href: "/work-hq/service-history", label: "Service History", icon: FileText },
    ],
  },
  {
    id: "earnings",
    label: "Earnings HQ",
    icon: Wallet,
    items: [
      { href: "/earnings-hq", label: "Overview", icon: Wallet },
      { href: "/earnings", label: "Earnings", icon: Wallet },
      { href: "/wallet", label: "Wallet", icon: Wallet },
      { href: "/earnings/payouts", label: "Payouts", icon: FileText },
      { href: "/earnings-hq/incentives", label: "Incentives", icon: Award },
      { href: "/earnings-hq/tax-center", label: "Tax Center", icon: FileCheck2 },
      { href: "/earnings-hq/forecast", label: "Forecast", icon: Sparkles },
    ],
  },
  {
    id: "performance",
    label: "Performance HQ",
    icon: BarChart3,
    items: [
      { href: "/reviews", label: "Reviews", icon: Star },
      { href: "/performance-hq/scorecard", label: "Scorecard", icon: BarChart3 },
      { href: "/performance-hq/rankings", label: "Rankings", icon: Trophy },
      { href: "/performance-hq/quality-insights", label: "Quality Insights", icon: Star },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    id: "ai",
    label: "AI HQ",
    icon: Brain,
    items: [
      { href: "/ai", label: "AI Assistant", icon: Sparkles, badgeLabel: "Live" },
      { href: "/ai-hq/earnings-coach", label: "Earnings Coach", icon: Brain },
      { href: "/ai-hq/demand-forecast", label: "Demand Forecast", icon: Sparkles },
      { href: "/ai-hq/route-optimization", label: "Route AI", icon: Route },
      { href: "/intelligence", label: "Growth Advisor", icon: Brain },
    ],
  },
  {
    id: "territory",
    label: "Territory HQ",
    icon: MapPinned,
    items: [
      { href: "/navigation", label: "Navigation", icon: Navigation2 },
      { href: "/territory-hq/heatmap", label: "Heatmap", icon: Compass },
      { href: "/territory-hq/coverage-areas", label: "Coverage Areas", icon: MapPinned },
      { href: "/territory-hq", label: "Territory Analytics", icon: MapPinned },
    ],
  },
  {
    id: "academy",
    label: "Partner Academy",
    icon: GraduationCap,
    items: [
      { href: "/academy", label: "Training", icon: GraduationCap },
      { href: "/academy/certifications", label: "Certifications", icon: Award },
    ],
  },
  {
    id: "trust",
    label: "Trust & Compliance",
    icon: ShieldCheck,
    items: [
      { href: "/trust-compliance", label: "Documents", icon: FileText },
      { href: "/trust-compliance/verification", label: "Verification", icon: ShieldCheck },
      { href: "/trust-compliance/compliance", label: "Compliance", icon: FileCheck2 },
    ],
  },
  {
    id: "rewards",
    label: "Rewards HQ",
    icon: Crown,
    items: [
      { href: "/rewards", label: "Rewards", icon: Crown },
      { href: "/rewards/badges", label: "Badges", icon: Award },
      { href: "/rewards/referrals", label: "Referrals", icon: Trophy },
    ],
  },
  {
    id: "wellbeing",
    label: "Wellbeing HQ",
    icon: HeartPulse,
    items: [
      { href: "/wellbeing", label: "Insurance", icon: HeartPulse },
      { href: "/wellbeing/sos", label: "SOS", icon: HeartPulse },
      { href: "/wellbeing/community", label: "Community", icon: MessageSquare },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: Settings,
    items: [
      { href: "/profile", label: "Profile", icon: MessageSquare },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/support", label: "Help & Support", icon: HelpCircle },
      { href: "/membership", label: "Membership", icon: Crown },
      { href: "/invoices", label: "Invoices", icon: FileText },
    ],
  },
];

export function isPartnerNavActive(pathname: string, href: string, label: string): boolean {
  if (label === "Dashboard") return pathname === "/";
  if (label === "Live Status") return pathname === "/work-hq";
  if (label === "Requests") return pathname === "/requests";
  if (label === "Bookings") return pathname.startsWith("/requests");
  if (label === "Overview") return pathname === "/earnings-hq";
  if (label === "Earnings") return pathname.startsWith("/earnings") && !pathname.startsWith("/earnings/payouts") && !pathname.startsWith("/earnings-hq");
  if (label === "Wallet") return pathname.startsWith("/wallet");
  if (label === "Payouts") return pathname.startsWith("/earnings/payouts");
  if (label === "Analytics") return pathname.startsWith("/analytics");
  if (label === "AI Assistant") return pathname === "/ai";
  if (label === "Growth Advisor") return pathname.startsWith("/intelligence");
  if (label === "Territory Analytics") return pathname === "/territory-hq";
  if (label === "Training") return pathname === "/academy";
  if (label === "Documents") return pathname === "/trust-compliance";
  if (label === "Rewards") return pathname === "/rewards";
  if (label === "Insurance") return pathname === "/wellbeing";
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}
