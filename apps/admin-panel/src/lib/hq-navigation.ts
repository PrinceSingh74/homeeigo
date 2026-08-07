import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Gauge,
  Globe2,
  Radio,
  Bell,
  Flame,
  CloudSun,
  MapPinned,
  Star,
  Users,
  Wrench,
  CalendarCheck,
  LayoutGrid,
  Crown,
  BarChart3,
  Coins,
  Clock,
  Gift,
  Megaphone,
  Headphones,
  ArrowLeftRight,
  CreditCard,
  Landmark,
  Scale,
  Database,
  AlertTriangle,
  Banknote,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  CheckCircle,
  Layers,
  FileText,
  UserX,
  Bot,
  Settings,
  TrendingUp,
  Activity,
  LineChart,
  Navigation,
  Wallet,
  Mail,
} from "lucide-react";

export type HqSectionId =
  | "executive"
  | "operations"
  | "marketplace"
  | "growth"
  | "finance"
  | "risk"
  | "ai"
  | "monitoring"
  | "platform";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type HqSection = {
  id: HqSectionId;
  label: string;
  shortLabel: string;
  emoji: string;
  dashboardHref: string;
  description: string;
  accent: string;
  items: readonly NavItem[];
};

/** Single source of truth — maps all 52+ routes into 9 Enterprise HQs. */
export const HQ_SECTIONS: readonly HqSection[] = [
  {
    id: "executive",
    label: "Executive HQ",
    shortLabel: "Executive",
    emoji: "👑",
    dashboardHref: "/",
    description: "Board-ready intelligence, revenue pulse, and platform health.",
    accent: "amber",
    items: [{ href: "/", label: "Executive Dashboard", icon: LayoutDashboard }],
  },
  {
    id: "operations",
    label: "Operations HQ",
    shortLabel: "Operations",
    emoji: "🚀",
    dashboardHref: "/hq/operations",
    description: "Mission control, live ops, geo intelligence, and alert routing.",
    accent: "blue",
    items: [
      { href: "/command-center", label: "Command Center", icon: Gauge },
      { href: "/eta-intelligence", label: "ETA Intelligence", icon: Navigation },
      { href: "/operations", label: "Live Ops", icon: Radio },
      { href: "/workforce", label: "Workforce Analytics", icon: Users },
      { href: "/coverage", label: "Coverage Intelligence", icon: MapPinned },
      { href: "/geospatial", label: "Geo Command", icon: Globe2 },
      { href: "/alerts", label: "Alert Center", icon: Bell },
      { href: "/heatmap", label: "Demand Heatmap", icon: Flame },
      { href: "/weather", label: "Weather Center", icon: CloudSun },
      { href: "/geofences", label: "Geofences", icon: MapPinned },
      { href: "/digital-twin", label: "Digital Twin", icon: Globe2 },
    ],
  },
  {
    id: "marketplace",
    label: "Marketplace HQ",
    shortLabel: "Marketplace",
    emoji: "🏪",
    dashboardHref: "/hq/marketplace",
    description: "Customers, partners, bookings, services, and catalog intelligence.",
    accent: "violet",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/vendors", label: "Partners", icon: Wrench },
      { href: "/vendors/documents", label: "Document Review", icon: FileText },
      { href: "/academy", label: "Partner Academy", icon: LayoutGrid },
      { href: "/bookings", label: "Bookings", icon: CalendarCheck },
      { href: "/reviews", label: "Reviews", icon: Star },
      { href: "/services", label: "Services", icon: LayoutGrid },
      { href: "/membership", label: "Membership", icon: Crown },
      { href: "/membership/cashback", label: "Cashback", icon: Coins },
      { href: "/membership/queue", label: "Priority Queue", icon: Clock },
      { href: "/membership/coupons", label: "Coupons", icon: Gift },
      { href: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    id: "growth",
    label: "Growth HQ",
    shortLabel: "Growth",
    emoji: "📈",
    dashboardHref: "/hq/growth",
    description: "Campaigns, retention, referrals, loyalty, and growth analytics.",
    accent: "emerald",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/membership/analytics", label: "Membership Analytics", icon: LineChart },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/referrals", label: "Referrals", icon: Gift },
      { href: "/loyalty", label: "Loyalty", icon: Coins },
      { href: "/gift-cards", label: "Gift Cards", icon: Gift },
      { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
    ],
  },
  {
    id: "finance",
    label: "Finance HQ",
    shortLabel: "Finance",
    emoji: "💰",
    dashboardHref: "/hq/finance",
    description: "Revenue, margins, wallets, settlements, and CFO operations.",
    accent: "yellow",
    items: [
      { href: "/finance/dashboard", label: "CFO Dashboard", icon: TrendingUp },
      { href: "/finance/config", label: "CFO Config", icon: Settings },
      { href: "/finance/reconciliation", label: "Reconciliation", icon: Landmark },
      { href: "/finance/settlement-sync", label: "Settlement Sync", icon: Scale },
      { href: "/finance/reports", label: "Reports", icon: FileText },
      { href: "/finance/payouts", label: "Payouts", icon: Banknote },
      { href: "/finance/refunds", label: "Refunds", icon: RotateCcw },
      { href: "/settlements", label: "Settlements", icon: Landmark },
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/finance/liabilities", label: "Liabilities", icon: Wallet },
      { href: "/finance/adjustments", label: "Adjustments", icon: Layers },
      { href: "/finance/backfill", label: "Ledger Backfill", icon: Database },
      { href: "/finance/hcoin-expiry", label: "H-Coin Expiry", icon: Coins },
    ],
  },
  {
    id: "risk",
    label: "Risk & Compliance HQ",
    shortLabel: "Risk",
    emoji: "🛡️",
    dashboardHref: "/hq/risk",
    description: "Fraud, chargebacks, compliance, KYC, and trust operations.",
    accent: "red",
    items: [
      { href: "/fraud", label: "Fraud Center", icon: ShieldAlert },
      { href: "/finance/chargebacks", label: "Chargebacks", icon: AlertTriangle },
      { href: "/chargebacks", label: "Chargeback Queue", icon: AlertTriangle },
      { href: "/finance/risk", label: "Risk Engine", icon: ShieldAlert },
      { href: "/finance/integrity", label: "Integrity", icon: ShieldCheck },
      { href: "/finance/validation", label: "Validation", icon: CheckCircle },
      { href: "/compliance", label: "Compliance", icon: Scale },
      { href: "/account-deletions", label: "Account Deletions", icon: UserX },
    ],
  },
  {
    id: "ai",
    label: "AI HQ",
    shortLabel: "AI",
    emoji: "🤖",
    dashboardHref: "/hq/ai",
    description: "AI systems, forecasting, demand prediction, and smart allocation.",
    accent: "cyan",
    items: [{ href: "/ai", label: "AI Systems", icon: Bot }],
  },
  {
    id: "monitoring",
    label: "Monitoring HQ",
    shortLabel: "Monitoring",
    emoji: "📡",
    dashboardHref: "/hq/monitoring",
    description: "Backend health, logs, metrics, tracing, and disaster recovery.",
    accent: "orange",
    items: [
      { href: "/observability", label: "Observability", icon: Activity },
      { href: "/observability/alerts", label: "Ops Alerts", icon: AlertTriangle },
      { href: "/observability/email", label: "Email Health", icon: Mail },
    ],
  },
  {
    id: "platform",
    label: "Platform HQ",
    shortLabel: "Platform",
    emoji: "⚙️",
    dashboardHref: "/hq/platform",
    description: "Settings, migrations, reports, support, and engineering controls.",
    accent: "zinc",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/finance/migrations", label: "Migrations", icon: Database },
      { href: "/finance/reports", label: "Exports & Reports", icon: FileText },
      { href: "/support", label: "Support", icon: Headphones },
    ],
  },
] as const;

const ALL_HREFS = HQ_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** Resolve which HQ owns the current pathname. */
export function resolveHqSection(pathname: string): HqSection {
  if (pathname.startsWith("/hq/")) {
    const slug = pathname.split("/")[2] as HqSectionId | undefined;
    const match = HQ_SECTIONS.find((s) => s.id === slug);
    if (match) return match;
  }
  for (const section of HQ_SECTIONS) {
    for (const item of section.items) {
      if (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) {
        return section;
      }
    }
  }
  return HQ_SECTIONS[0];
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function getHqSection(id: HqSectionId): HqSection | undefined {
  return HQ_SECTIONS.find((s) => s.id === id);
}

/** Flat list of every routable href (for prefetch / audits). */
export function getAllNavHrefs(): string[] {
  const hqDashboards = HQ_SECTIONS.map((s) => s.dashboardHref).filter((h) => h !== "/");
  return [...new Set([...ALL_HREFS, ...hqDashboards])];
}
