import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  CalendarCheck,
  CheckCircle,
  Clock,
  CloudSun,
  Coins,
  CreditCard,
  Crown,
  Database,
  Eye,
  FileText,
  Flame,
  Gauge,
  Gift,
  Globe2,
  GraduationCap,
  Headphones,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  Magnet,
  Mail,
  MapPinned,
  Megaphone,
  MessageSquare,
  Boxes,
  Navigation,
  Network,
  Radio,
  Rocket,
  RotateCcw,
  Scale,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Store,
  TrendingUp,
  Trophy,
  UserCheck,
  UserX,
  Users,
  Wallet,
  Workflow,
  Wrench,
} from "lucide-react";
import type { Icon3DTone } from "@/components/hq/Icon3D";

export type HqSectionId =
  | "executive"
  | "operations"
  | "marketplace"
  | "acquisition"
  | "growth"
  | "network"
  | "finance"
  | "risk"
  | "ai"
  | "automation"
  | "monitoring"
  | "audit"
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
  icon: LucideIcon;
  iconTone: Icon3DTone;
  dashboardHref: string;
  description: string;
  accent: string;
  items: readonly NavItem[];
  /**
   * Nav-visibility gate, backed by real `AdminResource` values from
   * `backend/prisma/schema.prisma`'s `AdminResource` enum and the role→resource grants in
   * `backend/src/services/rbac.service.ts`'s `DEFAULT_ROLES`.
   *
   * Finance / Risk / Growth stay gated on the exclusive resources they already used.
   * Audit HQ is gated on `AUDIT_LOGS` (FINANCE_ADMIN + ANALYTICS_ADMIN already hold READ).
   * Acquisition / Network / Automation are ungated at nav — the backend still 403s per route;
   * inventing a resource the enum does not have would hide pages a role can actually open.
   */
  requiredAnyResource?: readonly string[];
};

/** Single source of truth — Command Center IA mapped onto Enterprise HQs. */
export const HQ_SECTIONS: readonly HqSection[] = [
  {
    id: "executive",
    label: "Executive HQ",
    shortLabel: "Executive",
    emoji: "👑",
    icon: Crown,
    iconTone: "gold",
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
    icon: Rocket,
    iconTone: "default",
    dashboardHref: "/hq/operations",
    description: "Mission control, live ops, availability, and geo intelligence.",
    accent: "blue",
    items: [
      { href: "/command-center", label: "Command Center", icon: Gauge },
      { href: "/availability", label: "Availability", icon: UserCheck },
      { href: "/operations", label: "Live Ops", icon: Radio },
      { href: "/performance", label: "Performance", icon: TrendingUp },
      { href: "/supply-demand", label: "Supply-Demand", icon: Flame },
      { href: "/eta-intelligence", label: "ETA Intelligence", icon: Navigation },
      { href: "/workforce", label: "Workforce Analytics", icon: Users },
      { href: "/coverage", label: "Coverage Intelligence", icon: MapPinned },
      { href: "/geospatial", label: "Geo Command", icon: Globe2 },
      { href: "/alerts", label: "Alert Center", icon: Bell },
      { href: "/heatmap", label: "Demand Heatmap", icon: Flame },
      { href: "/weather", label: "Weather Center", icon: CloudSun },
      { href: "/geofences", label: "Zone Control", icon: MapPinned },
      { href: "/digital-twin", label: "City Twin", icon: Globe2 },
    ],
  },
  {
    id: "marketplace",
    label: "Marketplace HQ",
    shortLabel: "Marketplace",
    emoji: "🏪",
    icon: Store,
    iconTone: "violet",
    dashboardHref: "/hq/marketplace",
    description: "Customers, partners, jobs, services, and catalog intelligence.",
    accent: "violet",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/vendors", label: "Partners", icon: Wrench },
      { href: "/vendors/documents", label: "Document Review", icon: FileText },
      { href: "/academy", label: "Training", icon: GraduationCap },
      { href: "/bookings", label: "Jobs", icon: CalendarCheck },
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
    id: "acquisition",
    label: "Acquisition HQ",
    shortLabel: "Acquisition",
    emoji: "🧲",
    icon: Magnet,
    iconTone: "indigo",
    dashboardHref: "/hq/acquisition",
    description: "Leads, applications, verification, sources, and acquisition analytics.",
    accent: "violet",
    items: [
      { href: "/partner-acquisition", label: "Acquisition", icon: Users },
      { href: "/partner-acquisition/leads", label: "Leads", icon: Users },
      { href: "/partner-acquisition/applications", label: "Applications", icon: FileText },
      { href: "/partner-acquisition/verification", label: "Verification", icon: ShieldCheck },
      { href: "/partner-acquisition/approvals", label: "Approvals", icon: CheckCircle },
      { href: "/partner-acquisition/sources", label: "Sources", icon: BarChart3 },
      { href: "/partner-acquisition/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    id: "growth",
    label: "Growth HQ",
    shortLabel: "Growth",
    emoji: "📈",
    icon: TrendingUp,
    iconTone: "success",
    dashboardHref: "/hq/growth",
    description:
      "Revenue pulse, membership conversion, campaigns, loyalty, gift cards, and wallet transfers — live numbers with a clear meaning on every tile.",
    accent: "emerald",
    requiredAnyResource: ["CAMPAIGNS", "GIFT_CARDS", "MEMBERSHIPS"],
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/membership/analytics", label: "Membership Analytics", icon: LineChart },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/incentives", label: "Incentives", icon: Trophy },
      { href: "/loyalty", label: "Loyalty", icon: Coins },
      { href: "/gift-cards", label: "Gift Cards", icon: Gift },
      { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
    ],
  },
  {
    id: "network",
    label: "Network HQ",
    shortLabel: "Network",
    emoji: "🕸️",
    icon: Network,
    iconTone: "cyan",
    dashboardHref: "/hq/network",
    description: "Partner referral network — Section 07 canonical surfaces.",
    accent: "emerald",
    items: [{ href: "/referrals", label: "Referrals", icon: Network }],
  },
  {
    id: "finance",
    label: "Finance HQ",
    shortLabel: "Finance",
    emoji: "💰",
    icon: Landmark,
    iconTone: "warning",
    dashboardHref: "/hq/finance",
    description: "Revenue, earnings, wallets, settlements, and CFO operations.",
    accent: "yellow",
    requiredAnyResource: ["PAYMENTS", "WALLET"],
    items: [
      { href: "/finance/dashboard", label: "CFO Dashboard", icon: TrendingUp },
      { href: "/earnings", label: "Earnings", icon: Wallet },
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
    label: "Trust & Safety HQ",
    shortLabel: "Trust",
    emoji: "🛡️",
    icon: ShieldCheck,
    iconTone: "danger",
    dashboardHref: "/hq/risk",
    description: "Fraud, KYC, compliance, incidents, and trust operations.",
    accent: "red",
    requiredAnyResource: ["DISPUTES"],
    items: [
      { href: "/fraud", label: "Fraud Center", icon: ShieldAlert },
      { href: "/kyc", label: "KYC", icon: ShieldCheck },
      { href: "/finance/chargebacks", label: "Chargebacks", icon: AlertTriangle },
      { href: "/chargebacks", label: "Chargeback Queue", icon: AlertTriangle },
      { href: "/finance/risk", label: "Risk Engine", icon: ShieldAlert },
      { href: "/finance/integrity", label: "Integrity", icon: ShieldCheck },
      { href: "/finance/validation", label: "Validation", icon: CheckCircle },
      { href: "/compliance", label: "Compliance", icon: Scale },
      { href: "/trust-safety", label: "Trust & Safety", icon: ShieldCheck },
      { href: "/trust-safety/compliance", label: "Partner Compliance", icon: Scale },
      { href: "/trust-safety/risk", label: "Partner Risk", icon: ShieldAlert },
      { href: "/trust-safety/incidents", label: "Safety Incidents", icon: AlertTriangle },
      { href: "/account-deletions", label: "Account Deletions", icon: UserX },
    ],
  },
  {
    id: "ai",
    label: "Intelligence HQ",
    shortLabel: "Intelligence",
    emoji: "🤖",
    icon: Brain,
    iconTone: "violet",
    dashboardHref: "/hq/ai",
    description: "AI insights, forecasting, demand prediction, and smart allocation.",
    accent: "cyan",
    items: [
      { href: "/ai-insights", label: "AI Insights", icon: Brain },
      { href: "/ai-brain", label: "AI Brain Console", icon: Brain },
      { href: "/ai-brain/context", label: "Context Explorer", icon: Layers },
      { href: "/ai-brain/memory", label: "Memory Explorer", icon: Database },
      { href: "/ai-brain/prompts", label: "Prompt Registry", icon: FileText },
      { href: "/ai-brain/timeline", label: "Activity Timeline", icon: Clock },
      { href: "/ai-brain/tools", label: "Enterprise Tool Center", icon: Wrench },
      { href: "/ai-brain/approvals", label: "High-Risk Approvals", icon: ShieldAlert },
      // Placed next to the tool center and the approval queue rather than in Automation HQ: an
      // agent run is read by following it into its tool executions and, when it escalates, into
      // the approval queue, so the three belong side by side.
      { href: "/agents", label: "Agent Control Center", icon: Bot },
      { href: "/knowledge", label: "Knowledge Base", icon: BookOpen },
      { href: "/knowledge/ask", label: "Knowledge Assistant", icon: MessageSquare },
      { href: "/ml", label: "Model Governance", icon: Boxes },
      { href: "/vision", label: "Vision Analytics", icon: Eye },
      { href: "/ai", label: "AI Systems", icon: Bot },
    ],
  },
  {
    id: "automation",
    label: "Automation HQ",
    shortLabel: "Automation",
    emoji: "⚙️",
    icon: Workflow,
    iconTone: "slate",
    dashboardHref: "/hq/automation",
    description: "Workflows, events, outbox, DLQ, and Section 09 governance.",
    accent: "cyan",
    items: [
      { href: "/automation", label: "Automation Center", icon: Workflow },
      { href: "/automation/events", label: "Event Explorer", icon: Activity },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring HQ",
    shortLabel: "Monitoring",
    emoji: "📡",
    icon: Activity,
    iconTone: "orange",
    dashboardHref: "/hq/monitoring",
    description: "Backend health, logs, metrics, tracing, and disaster recovery.",
    accent: "orange",
    items: [
      { href: "/observability", label: "Observability", icon: Activity },
      { href: "/observability/alerts", label: "Ops Alerts", icon: AlertTriangle },
      { href: "/observability/email", label: "Email Health", icon: Mail },
      { href: "/observability/logs", label: "Log Search", icon: FileText },
    ],
  },
  {
    id: "audit",
    label: "Audit HQ",
    shortLabel: "Audit",
    emoji: "📜",
    icon: ScrollText,
    iconTone: "slate",
    dashboardHref: "/hq/audit",
    description: "Enterprise audit explorer — actor, entity, request, and correlation.",
    accent: "zinc",
    requiredAnyResource: ["AUDIT_LOGS"],
    items: [{ href: "/audit", label: "Audit Explorer", icon: ScrollText }],
  },
  {
    id: "platform",
    label: "Platform HQ",
    shortLabel: "Platform",
    emoji: "⚙️",
    icon: Settings,
    iconTone: "slate",
    dashboardHref: "/hq/platform",
    description: "Settings, migrations, support, and engineering controls.",
    accent: "zinc",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/finance/migrations", label: "Migrations", icon: Database },
      { href: "/support", label: "Support", icon: Headphones },
    ],
  },
] as const;

/** One-line meaning for nav items — shown as tooltips and HQ quick-link copy. */
export const NAV_ITEM_HINTS: Record<string, string> = {
  "/": "Board-ready revenue, jobs, and platform health",
  "/command-center": "Live ops mission control",
  "/availability": "Who can take a job right now",
  "/operations": "Live jobs and partner movement",
  "/performance": "SLA, completion, and quality",
  "/supply-demand": "Where demand outruns supply",
  "/eta-intelligence": "Arrival accuracy and delays",
  "/workforce": "Partner utilisation and roster",
  "/coverage": "City and zone coverage gaps",
  "/geospatial": "Map command for live geo",
  "/alerts": "Ops alerts that need a decision",
  "/heatmap": "Demand intensity by area",
  "/weather": "Weather impact on jobs",
  "/geofences": "Service zones and restrictions",
  "/digital-twin": "City-scale operational twin",
  "/customers": "Customer accounts and activity",
  "/vendors": "Partner lifecycle and roster",
  "/vendors/documents": "KYC and document review",
  "/academy": "Training completion and readiness",
  "/bookings": "Job pipeline and assignment",
  "/reviews": "Ratings and quality signals",
  "/services": "Catalog, pricing, and availability",
  "/membership": "Plans, subscribers, and perks",
  "/membership/cashback": "Cashback liability and grants",
  "/membership/queue": "Priority booking queue",
  "/membership/coupons": "Member coupon inventory",
  "/payments": "Checkout and payment status",
  "/partner-acquisition": "Lead-to-active partner funnel",
  "/partner-acquisition/leads": "Inbound partner leads",
  "/partner-acquisition/applications": "Applications in review",
  "/partner-acquisition/verification": "Identity and document checks",
  "/partner-acquisition/approvals": "Ready-to-activate partners",
  "/partner-acquisition/sources": "Which channels bring partners",
  "/partner-acquisition/analytics": "Acquisition conversion and cost",
  "/analytics": "Revenue, bookings, and conversion",
  "/membership/analytics": "MRR, churn, and plan mix",
  "/campaigns": "Coupons and premium offers",
  "/incentives": "Partner bonus rules — not wallet credits",
  "/loyalty": "H-Coin rules, liability, and grants",
  "/gift-cards": "Issued cards and outstanding balance",
  "/transfers": "Wallet-to-wallet movement audit",
  "/referrals": "Partner and customer referral network",
  "/finance/dashboard": "CFO revenue and margin pulse",
  "/earnings": "Partner earnings by finance state",
  "/finance/config": "Fee, tax, and payout configuration",
  "/finance/reconciliation": "Ledger vs gateway vs bank",
  "/finance/settlement-sync": "Settlement pipeline health",
  "/finance/reports": "Finance exports and packs",
  "/finance/payouts": "Withdrawal processing",
  "/finance/refunds": "Refund queue and status",
  "/settlements": "Partner settlement cycles",
  "/invoices": "Customer invoices and net revenue",
  "/finance/liabilities": "Open money still owed",
  "/finance/adjustments": "Manual ledger adjustments",
  "/finance/backfill": "Historical ledger repair",
  "/finance/hcoin-expiry": "Expiring H-Coin liability",
  "/fraud": "Fraud alerts and bans",
  "/kyc": "Identity verification queue",
  "/finance/chargebacks": "Chargeback cases",
  "/chargebacks": "Chargeback working queue",
  "/finance/risk": "Payment risk engine",
  "/finance/integrity": "Ledger integrity checks",
  "/finance/validation": "Finance validation gates",
  "/compliance": "Policy and compliance status",
  "/trust-safety": "Trust operations overview",
  "/trust-safety/compliance": "Partner compliance posture",
  "/trust-safety/risk": "Partner risk scores",
  "/trust-safety/incidents": "Safety incident response",
  "/account-deletions": "Account deletion requests",
  "/ai-insights": "AI-generated ops insights",
  "/ai-brain": "AI brain console",
  "/ai-brain/context": "Context the models can see",
  "/ai-brain/memory": "Stored AI memory",
  "/ai-brain/prompts": "Prompt registry",
  "/ai-brain/timeline": "AI activity timeline",
  "/ai-brain/tools": "Enterprise tool executions",
  "/ai-brain/approvals": "High-risk AI actions waiting",
  "/agents": "Agent runs and control",
  "/knowledge": "Internal knowledge base",
  "/knowledge/ask": "Ask the knowledge assistant",
  "/ml": "Model governance and versions",
  "/vision": "Vision analysis usage",
  "/ai": "AI systems inventory",
  "/automation": "Workflows and automations",
  "/automation/events": "Event explorer",
  "/observability": "Backend health and traces",
  "/observability/alerts": "Ops alert rules",
  "/observability/email": "Transactional email health",
  "/observability/logs": "Log search",
  "/audit": "Who did what, when, and why",
  "/settings": "Platform settings",
  "/finance/migrations": "Finance data migrations",
  "/support": "Support tickets and SLA",
};

export function navItemHint(href: string): string | undefined {
  return NAV_ITEM_HINTS[href];
}

const ALL_HREFS = HQ_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** Resolve which HQ owns the current pathname. Longest href match wins. */
export function resolveHqSection(pathname: string): HqSection {
  if (pathname.startsWith("/hq/")) {
    const slug = pathname.split("/")[2] as HqSectionId | undefined;
    const match = HQ_SECTIONS.find((s) => s.id === slug);
    if (match) return match;
  }
  let best: { section: HqSection; len: number } | null = null;
  for (const section of HQ_SECTIONS) {
    for (const item of section.items) {
      const hit = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
      if (!hit) continue;
      const len = item.href === "/" ? 1 : item.href.length;
      if (!best || len > best.len) best = { section, len };
    }
  }
  return best?.section ?? HQ_SECTIONS[0];
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
