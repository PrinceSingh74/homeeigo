/**
 * The HQ menu, as data. Pure (no import) so its rules are unit-tested: every screen is listed once,
 * nothing listed duplicates a tab, and no row carries a badge the server did not send.
 *
 * A subtitle says what the screen DOES today — not what a fuller version might. Where a screen
 * hands off to another app it says so ("open in Maps"); where it is a list it says "list".
 *
 * Ids are the `/hq/<id>` routes. They are stable: device tests and notifications deep-link to them.
 * Labels the device tests tap by word are kept as they are (see `e2e/native-android-*.ts`):
 * Availability, Scorecard, Career, Compliance, Documents, SOS, Referrals, Notifications,
 * AI Assistant, Demand Forecast, Route AI, Growth Advisor, Territory Analytics, and the forecast's
 * "Today, weekly, monthly" subtitle.
 */
export type HqIconName =
  | "activity"
  | "route"
  | "clock"
  | "toggle"
  | "calendar"
  | "history"
  | "map"
  | "wallet"
  | "chart"
  | "banknote"
  | "receipt"
  | "gift"
  | "tax"
  | "trend"
  | "invoice"
  | "star"
  | "gauge"
  | "ladder"
  | "trophy"
  | "lightbulb"
  | "sparkles"
  | "brain"
  | "navigation"
  | "compass"
  | "pin"
  | "graduation"
  | "award"
  | "badge-check"
  | "briefcase"
  | "file"
  | "shield"
  | "clipboard-check"
  | "crown"
  | "users"
  | "siren"
  | "heart"
  | "message"
  | "user"
  | "bell"
  | "settings"
  | "help"
  | "id-card";

/**
 * `badge` is only ever "Coming soon": a screen that is planned and visibly inert (DESIGN.md, Truth).
 * A status the server did not send ("Live", "New") is never a badge.
 */
export type HqMenuItem = { id: string; label: string; subtitle: string; icon: HqIconName; badge?: "Coming soon" };
export type HqMenuSection = { id: string; label: string; icon: HqIconName; items: HqMenuItem[] };

export const HQ_MENU: readonly HqMenuSection[] = [
  {
    id: "work",
    label: "Work",
    icon: "briefcase",
    items: [
      { id: "account-availability", label: "Availability", subtitle: "Go online, pause, working hours, job limits and service area", icon: "toggle" },
      { id: "work-hq", label: "Live status", subtitle: "Requests, active jobs and online status", icon: "activity" },
      { id: "work-schedule", label: "Schedule", subtitle: "Working days and upcoming jobs", icon: "calendar" },
      { id: "account-map", label: "Live map", subtitle: "Your active jobs on a map; directions open in Maps", icon: "map" },
      { id: "route-center", label: "Route center", subtitle: "A suggested order for your active stops", icon: "route" },
      { id: "work-attendance", label: "Attendance", subtitle: "Check in, check out and past sessions", icon: "clock" },
      { id: "work-service-history", label: "Service history", subtitle: "Counts of completed, cancelled, rescheduled and upcoming jobs", icon: "history" },
    ],
  },
  {
    id: "earnings",
    label: "Earnings",
    icon: "wallet",
    items: [
      { id: "earnings-hq", label: "Overview", subtitle: "Today, last 7 and 30 days (net)", icon: "chart" },
      { id: "earnings-detail", label: "Earnings", subtitle: "By period, day by day", icon: "trend" },
      { id: "wallet", label: "Wallet", subtitle: "Balance, withdrawals and job earnings", icon: "wallet" },
      { id: "earnings-payouts", label: "Withdrawals", subtitle: "Requests and their status", icon: "banknote" },
      { id: "account-invoices", label: "Invoices", subtitle: "Earning invoices and settlements", icon: "invoice" },
      { id: "earnings-incentives", label: "Incentives", subtitle: "Bonus rules and your progress", icon: "gift" },
      { id: "earnings-tax", label: "Tax summary", subtitle: "All-time totals and estimates", icon: "tax" },
      { id: "earnings-forecast", label: "Earnings outlook", subtitle: "Today, weekly, monthly. Only today is an estimate", icon: "sparkles" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: "gauge",
    items: [
      { id: "performance-reviews", label: "Reviews", subtitle: "Customer ratings; reply to a review", icon: "star" },
      { id: "performance-scorecard", label: "Scorecard", subtitle: "Your score, its parts and why it changed", icon: "gauge" },
      { id: "performance-career", label: "Career", subtitle: "Level, requirements and badges", icon: "ladder" },
      { id: "performance-rankings", label: "Rankings", subtitle: "City and category ranks", icon: "trophy" },
      { id: "performance-quality", label: "Quality", subtitle: "Your recorded rates", icon: "lightbulb" },
      { id: "performance-analytics", label: "Analytics", subtitle: "Earnings by period and job rates", icon: "chart" },
    ],
  },
  {
    id: "ai",
    label: "Assistant and insights",
    icon: "brain",
    items: [
      { id: "ai-assistant", label: "AI Assistant", subtitle: "Ask a question about your work", icon: "sparkles" },
      { id: "ai-demand-forecast", label: "Demand Forecast", subtitle: "Expected demand by zone for the next 24 hours", icon: "trend" },
      { id: "ai-route", label: "Route AI", subtitle: "A suggested stop order for your active jobs", icon: "route" },
      { id: "ai-intelligence", label: "Growth Advisor", subtitle: "Surge zones and recommendations", icon: "brain" },
    ],
  },
  {
    id: "territory",
    label: "Territory",
    icon: "pin",
    items: [
      { id: "territory-navigation", label: "Navigation", subtitle: "Your active jobs, with links that open directions in Google Maps", icon: "navigation" },
      { id: "territory-heatmap", label: "Surge zones", subtitle: "A list of surge zones and their multipliers", icon: "compass" },
      { id: "territory-coverage", label: "Coverage areas", subtitle: "How many partners serve each zone", icon: "pin" },
      { id: "territory-analytics", label: "Territory Analytics", subtitle: "Demand and supply by zone", icon: "chart", badge: "Coming soon" },
    ],
  },
  {
    id: "academy",
    label: "Training and credentials",
    icon: "graduation",
    items: [
      { id: "academy-training", label: "Training", subtitle: "Training modules; mark one complete when you finish it", icon: "graduation" },
      { id: "academy-certifications", label: "Certifications", subtitle: "Certifications recorded on your profile", icon: "award" },
      { id: "academy-credentials", label: "My credentials", subtitle: "Declare skills, certificates, equipment, insurance, languages", icon: "badge-check" },
      { id: "academy-services", label: "My services", subtitle: "Services you perform and whether you are offered their jobs", icon: "briefcase" },
    ],
  },
  {
    id: "trust",
    label: "Trust",
    icon: "shield",
    items: [
      { id: "trust-documents", label: "Documents", subtitle: "Your documents, their status and expiry; upload or renew one", icon: "file" },
      { id: "trust-verification", label: "Verification", subtitle: "KYC and background check status", icon: "shield" },
      { id: "trust-compliance", label: "Compliance", subtitle: "Your compliance status and what needs action", icon: "clipboard-check" },
    ],
  },
  {
    id: "rewards",
    label: "Rewards",
    icon: "crown",
    items: [
      { id: "rewards-hub", label: "Rewards", subtitle: "Milestones, badges and incentive earnings", icon: "crown" },
      { id: "rewards-badges", label: "Badges", subtitle: "Badges you have earned", icon: "award" },
      { id: "rewards-referrals", label: "Referrals", subtitle: "Invite partners and follow their progress", icon: "users" },
    ],
  },
  {
    id: "wellbeing",
    label: "Safety and wellbeing",
    icon: "heart",
    items: [
      { id: "wellbeing-sos", label: "SOS", subtitle: "Send an SOS, set your emergency contact, report a safety concern", icon: "siren" },
      { id: "wellbeing-insurance", label: "Insurance", subtitle: "Open the partner insurance portal", icon: "heart" },
      { id: "wellbeing-community", label: "Community", subtitle: "Community link and recent announcements", icon: "message" },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: "user",
    items: [
      { id: "account-profile", label: "Profile", subtitle: "Your details, email verification, password and devices", icon: "id-card" },
      { id: "account-notifications", label: "Notifications", subtitle: "Read, open and delete alerts; choose optional alerts", icon: "bell" },
      { id: "account-settings", label: "Settings", subtitle: "Bio, app preferences and payout preference", icon: "settings" },
      { id: "account-support", label: "Help and support", subtitle: "Raise a ticket, read the thread and reply", icon: "help" },
      { id: "account-membership", label: "Membership", subtitle: "Plans and benefits", icon: "crown" },
    ],
  },
];

/**
 * Old `/hq/<id>` routes that are no longer screens: each was a duplicate of a tab. A link to one
 * (an old notification, a bookmark) lands on the tab instead of on "not found".
 */
export const HQ_REDIRECTS: Readonly<Record<string, string>> = {
  dashboard: "/(tabs)",
  requests: "/(tabs)/requests",
  // The old "full ledger" row. A partner has no ledger endpoint; what it showed is the withdrawals list.
  "wallet-ledger": "/hq/earnings-payouts",
};

export const HQ_MENU_IDS: readonly string[] = HQ_MENU.flatMap((s) => s.items.map((i) => i.id));

export function findMenuItem(id: string): { section: HqMenuSection; item: HqMenuItem } | null {
  for (const section of HQ_MENU) {
    const item = section.items.find((i) => i.id === id);
    if (item) return { section, item };
  }
  return null;
}

/** Sections whose items match `query` (label or subtitle, case-insensitive). An empty query is the whole menu. */
export function filterMenu(query: string): HqMenuSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...HQ_MENU];
  return HQ_MENU.map((s) => ({ ...s, items: s.items.filter((i) => i.label.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q)) })).filter((s) => s.items.length > 0);
}
