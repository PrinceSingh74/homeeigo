/**
 * Admin copilot intent — rule-based. High-risk phrasing never opens write/high-risk tools.
 */

export type AdminAiIntent = "DEMAND_SUPPLY" | "OPERATIONS" | "FINANCE_READ" | "MUTATION_REQUEST" | "GENERAL";

export type AdminIntentResult = {
  intent: AdminAiIntent;
  confidence: number;
  rule: string;
};

type Rule = { intent: AdminAiIntent; name: string; pattern: RegExp };

const RULES: Rule[] = [
  {
    intent: "MUTATION_REQUEST",
    name: "high_risk_mutation",
    pattern:
      /\b(refund|wallet\s+adjust|payout\s+now|suspend\s+partner|ban\s+|freeze\s+account|settle\s+now|approve\s+payout)\b/i,
  },
  {
    intent: "DEMAND_SUPPLY",
    name: "supply_short",
    pattern: /\b(supply\s+short|shortage|demand|gap|where\s+is\s+supply|skill\s+gap|heatmap|zone)\b/i,
  },
  {
    intent: "FINANCE_READ",
    name: "finance_read",
    pattern: /\b(revenue|gmv|finance\s+summary|earnings\s+platform)\b/i,
  },
  {
    intent: "OPERATIONS",
    name: "operations",
    pattern: /\b(operations|online\s+partners|bookings\s+today|completion)\b/i,
  },
];

export function classifyAdminIntent(message: string): AdminIntentResult {
  const text = (message ?? "").trim();
  if (text.length === 0) return { intent: "GENERAL", confidence: 0, rule: "empty" };
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { intent: rule.intent, confidence: 1, rule: rule.name };
    }
  }
  return { intent: "GENERAL", confidence: 0, rule: "fallback" };
}
