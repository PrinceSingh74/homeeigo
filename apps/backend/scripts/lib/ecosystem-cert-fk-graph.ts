/**
 * Foreign-key dependency graph for ecosystem certification fixture teardown.
 * Tables with User FK and NO onDelete:Cascade must be deleted before users.
 */
export type FkEdge = { child: string; parent: string; onDelete: "Cascade" | "Restrict" | "SetNull" };

/** User-referencing relations without onDelete:Cascade (must delete explicitly before users). */
export const USER_RESTRICT_EDGES: FkEdge[] = [
  { child: "membership_benefit_usage", parent: "users", onDelete: "Restrict" },
  { child: "user_subscriptions", parent: "users", onDelete: "Restrict" },
  { child: "referral_withdrawals", parent: "users", onDelete: "Restrict" },
  { child: "hcoin_wallets", parent: "users", onDelete: "Restrict" },
  { child: "hcoin_transactions", parent: "users", onDelete: "Restrict" },
  { child: "gift_card_transactions", parent: "users", onDelete: "Restrict" },
  { child: "membership_cashbacks", parent: "users", onDelete: "Restrict" },
  { child: "provider_match_scores", parent: "users", onDelete: "Restrict" },
  { child: "membership_coupon_redemptions", parent: "users", onDelete: "Restrict" },
  { child: "referral_transactions", parent: "users", onDelete: "Restrict" },
  { child: "referral_commissions", parent: "users", onDelete: "Restrict" },
  { child: "wallet_transfers", parent: "users", onDelete: "Restrict" },
  { child: "gift_cards", parent: "users", onDelete: "Restrict" },
  { child: "coupon_usages", parent: "users", onDelete: "Restrict" },
  { child: "activity_logs", parent: "users", onDelete: "Restrict" },
  { child: "fraud_signals", parent: "users", onDelete: "Restrict" },
  { child: "fraud_alerts", parent: "users", onDelete: "Restrict" },
];

/** Certification cleanup delete phases (children before parents). */
export const CLEANUP_DELETE_ORDER_AFTER: string[] = [
  "location_history",
  "membership_coupon_redemptions",
  "membership_cashbacks",
  "coupon_usages",
  "ratings",
  "fraud_alerts",
  "referral_commissions",
  "assignment_audits",
  "assignment_attempts",
  "assignment_jobs",
  "activity_logs",
  "support_tickets",
  "payment_settlements",
  "payments",
  "earnings",
  "notifications",
  "provider_match_scores",
  "tracking",
  "bookings",
  "wallet_transactions",
  "locations",
  "provider_wallet_reservations",
  "providers",
  "subscription_invoices",
  "hcoin_transactions",
  "hcoin_wallets",
  "membership_benefit_usage",
  "membership_cashbacks",
  "membership_coupon_redemptions",
  "provider_match_scores",
  "referral_commissions",
  "fraud_alerts",
  "referral_transactions",
  "referral_withdrawals",
  "user_subscriptions",
  "wallet_transfers",
  "gift_card_transactions",
  "gift_cards",
  "coupon_usages",
  "activity_logs",
  "fraud_signals",
  "notifications",
  "payments",
  "addresses",
  "users",
  "services",
];

/** Pre-fix order (missing hcoin_wallets before users caused FK violation). */
export const CLEANUP_DELETE_ORDER_BEFORE: string[] = [
  "...booking_children",
  "wallet_transactions",
  "locations",
  "providers",
  "hcoin_transactions",
  "membership_benefit_usage",
  "...other_user_children",
  "addresses",
  "users  ← FAIL: hcoin_wallets still present",
  "services",
];

export function renderFkGraphMermaid(): string {
  const lines = ["graph TD", "  users[(users)]"];
  for (const e of USER_RESTRICT_EDGES) {
    lines.push(`  ${e.child}[${e.child}] -->|${e.onDelete}| ${e.parent}`);
  }
  lines.push("  bookings[(bookings)] -->|Cascade| users");
  lines.push("  hcoin_transactions -->|Restrict| users");
  lines.push("  hcoin_wallets -->|Restrict| users");
  return lines.join("\n");
}
