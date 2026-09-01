/**
 * Section 10 Partner Command Center IA — one coherent operational map over
 * existing HQ routes. Labels are the Command Center vocabulary; hrefs are the
 * canonical pages that already own the domain (no duplicate engines).
 */
export type CommandSurfaceId =
  | "overview"
  | "leads"
  | "applications"
  | "verification"
  | "partners"
  | "availability"
  | "live-ops"
  | "jobs"
  | "performance"
  | "earnings"
  | "payouts"
  | "incentives"
  | "kyc"
  | "training"
  | "referrals"
  | "support"
  | "safety"
  | "fraud"
  | "acquisition-analytics"
  | "supply-demand"
  | "ai-insights"
  | "audit";

export type CommandSurface = {
  id: CommandSurfaceId;
  label: string;
  href: string;
  description: string;
};

export const COMMAND_CENTER_SURFACES: readonly CommandSurface[] = [
  { id: "overview", label: "Overview", href: "/command-center", description: "Partner OS pulse" },
  { id: "leads", label: "Leads", href: "/partner-acquisition/leads", description: "Lead CRM" },
  { id: "applications", label: "Applications", href: "/partner-acquisition/applications", description: "Application pipeline" },
  { id: "verification", label: "Verification", href: "/partner-acquisition/verification", description: "Verification queue" },
  { id: "partners", label: "Partners", href: "/vendors", description: "Partner roster" },
  { id: "availability", label: "Availability", href: "/availability", description: "Live availability roster" },
  { id: "live-ops", label: "Live Operations", href: "/operations", description: "Live ops map" },
  { id: "jobs", label: "Jobs", href: "/bookings", description: "Bookings / jobs" },
  { id: "performance", label: "Performance", href: "/performance", description: "Fleet score & career" },
  { id: "earnings", label: "Earnings", href: "/earnings", description: "Partner earnings" },
  { id: "payouts", label: "Payouts", href: "/finance/payouts", description: "Withdrawals & batches" },
  { id: "incentives", label: "Incentives", href: "/incentives", description: "Bonus rules" },
  { id: "kyc", label: "KYC", href: "/kyc", description: "Identity & documents" },
  { id: "training", label: "Training", href: "/academy", description: "Partner academy" },
  { id: "referrals", label: "Referrals", href: "/referrals", description: "Partner network" },
  { id: "support", label: "Support", href: "/support", description: "Tickets" },
  { id: "safety", label: "Safety", href: "/trust-safety", description: "Trust & safety" },
  { id: "fraud", label: "Fraud", href: "/fraud", description: "Fraud center" },
  { id: "acquisition-analytics", label: "Acquisition Analytics", href: "/partner-acquisition/analytics", description: "Funnel & spend" },
  { id: "supply-demand", label: "Supply-Demand", href: "/supply-demand", description: "Heatmap & coverage" },
  { id: "ai-insights", label: "AI Insights", href: "/ai-insights", description: "Intelligence surfaces" },
  { id: "audit", label: "Audit", href: "/audit", description: "Audit explorer" },
] as const;

export function commandSurfaceForPath(pathname: string): CommandSurface | undefined {
  const exact = COMMAND_CENTER_SURFACES.find((s) => s.href === pathname);
  if (exact) return exact;
  return [...COMMAND_CENTER_SURFACES]
    .filter((s) => s.href !== "/" && pathname.startsWith(s.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
