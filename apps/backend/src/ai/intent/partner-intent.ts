/**
 * Partner copilot intent — rule-based, decided before any tool or context loads.
 *
 * Kept separate from the customer classifier so a partner asking "how much did I earn"
 * cannot be routed through customer SERVICE_SEARCH / PRICING tools, and so a mutation
 * request is recognised as a refusal rather than a finance tool call.
 */

export type PartnerAiIntent =
  | "EARNINGS"
  | "PAYOUT"
  | "JOBS"
  | "SCHEDULE"
  | "DEMAND"
  | "PERFORMANCE"
  | "TRAINING"
  | "ROUTE"
  | "CAREER"
  | "MUTATION_REQUEST"
  | "GENERAL";

export type PartnerIntentResult = {
  intent: PartnerAiIntent;
  confidence: number;
  rule: string;
};

type Rule = { intent: PartnerAiIntent; name: string; pattern: RegExp };

const RULES: Rule[] = [
  {
    intent: "MUTATION_REQUEST",
    name: "high_risk_mutation",
    pattern:
      /\b(pay\s+me|send\s+me\s+money|use\s+payout\s+tool|transfer\s+(money|funds)|payout\s+now|give\s+me\s+(an?\s+)?incentive|refund\s+me|adjust\s+(my\s+)?wallet|suspend|ban\s+partner|change\s+(my\s+)?(availability|status)|mark\s+(job|booking)\s+(complete|done)|database\s+access|direct\s+(db|database)\s+access)\b/i,
  },
  {
    intent: "PAYOUT",
    name: "payout_status",
    pattern: /\b(payout|withdraw\w*|settlement|when\s+(do|will)\s+i\s+get\s+paid|next\s+payment)\b/i,
  },
  {
    intent: "EARNINGS",
    name: "earnings",
    pattern: /\b(earn\w*|income|kitna\s+(kama|mila)|how\s+much\s+did\s+i|this\s+week.?s?\s+pay|net\s+(pay|amount))\b/i,
  },
  {
    intent: "TRAINING",
    name: "training",
    pattern: /\b(training|academy|module|course|learn|certif\w*)\b/i,
  },
  {
    intent: "CAREER",
    name: "career",
    pattern: /\b(expert|career|tier|level\s+up|how\s+can\s+i\s+reach|promot\w*)\b/i,
  },
  {
    intent: "PERFORMANCE",
    name: "performance",
    pattern: /\b(score|rating|performance|acceptance|why\s+did\s+my\s+score|how\s+am\s+i\s+(doing|performing))\b/i,
  },
  {
    intent: "ROUTE",
    name: "route",
    pattern: /\b(route|sequence|navigation|which\s+job\s+(first|next)|travel|eta)\b/i,
  },
  {
    intent: "JOBS",
    name: "jobs",
    pattern: /\b(job\w*|booking\w*|next\s+job|upcoming|assigned|my\s+work)\b/i,
  },
  {
    intent: "SCHEDULE",
    name: "schedule",
    pattern: /\b(schedule[d]?|shift|attendance|when\s+am\s+i|when\s+should\s+i\s+(work|go\s+online)|hours|roster)\b/i,
  },
  {
    intent: "DEMAND",
    name: "demand",
    pattern:
      /\b(demand|zone|sector|heatmap|surge|where\s+should\s+i|best\s+(time|zone)|opportunity|supply)\b/i,
  },
];

export function classifyPartnerIntent(message: string): PartnerIntentResult {
  const text = (message ?? "").trim();
  if (text.length === 0) return { intent: "GENERAL", confidence: 0, rule: "empty" };

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { intent: rule.intent, confidence: 1, rule: rule.name };
    }
  }
  return { intent: "GENERAL", confidence: 0, rule: "fallback" };
}

export const ALL_PARTNER_INTENTS: PartnerAiIntent[] = [
  "EARNINGS",
  "PAYOUT",
  "JOBS",
  "SCHEDULE",
  "DEMAND",
  "PERFORMANCE",
  "TRAINING",
  "ROUTE",
  "CAREER",
  "MUTATION_REQUEST",
  "GENERAL",
];
