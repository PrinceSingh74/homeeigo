/**
 * Deterministic intent classification.
 *
 * This runs *before* context is assembled, so it decides which data the request is even
 * allowed to load. That makes it a security-relevant step, and it is deliberately
 * rule-based rather than model-based: a model call here would add a round-trip and a
 * failure mode before we know what the user wants, and its output would be an untrusted
 * string steering an authorization decision.
 *
 * Rules are ordered by specificity. The first match wins, and everything unmatched falls
 * through to GENERAL — the narrowest context scope.
 */
export type AiIntent =
  | "SERVICE_SEARCH"
  | "PRICING_INQUIRY"
  | "BOOKING_STATUS"
  | "CANCEL_RESCHEDULE"
  | "COMPLAINT"
  | "ACCOUNT"
  | "GENERAL";

export type IntentResult = {
  intent: AiIntent;
  /** 1.0 for a direct rule hit, 0 for the GENERAL fallback. Never a model probability. */
  confidence: number;
  /** Which rule fired — carried into audit so a misroute can be traced to its rule. */
  rule: string;
};

type Rule = { intent: AiIntent; name: string; pattern: RegExp };

/**
 * Hinglish is first-class here: HOMIGO customers routinely mix scripts and write
 * "chahiye", "kitna", "kab aayega". Matching only English would send most real traffic to
 * GENERAL and starve it of catalog context.
 */
const RULES: Rule[] = [
  // Cancellation and rescheduling before booking-status: "cancel my booking" contains both.
  {
    intent: "CANCEL_RESCHEDULE",
    name: "cancel_reschedule",
    pattern: /\b(cancel|reschedul\w*|postpone|change\s+(the\s+)?(time|date|slot)|band\s+kar|radd|time\s+badal)\b/i,
  },
  {
    intent: "COMPLAINT",
    name: "complaint",
    pattern: /\b(complain\w*|refund|not\s+(happy|satisfied)|poor|bad\s+(service|work)|damage[ds]?|late|didn'?t\s+(come|arrive)|nahi\s+aaya|kharab|shikayat|paise\s+wapas)\b/i,
  },
  {
    intent: "PRICING_INQUIRY",
    name: "pricing",
    pattern: /\b(price|pricing|cost|charge[sd]?|rate|fee|how\s+much|kitna|kitne\s+(ka|rupay)|daam|kharcha|quote|estimate)\b/i,
  },
  {
    intent: "BOOKING_STATUS",
    name: "booking_status",
    pattern: /\b(my\s+booking|order\s+status|where\s+is|track|eta|arriv\w*|on\s+the\s+way|kab\s+aa\w*|kaha\s+hai|status)\b/i,
  },
  {
    intent: "ACCOUNT",
    name: "account",
    pattern: /\b(my\s+(account|profile|address|wallet)|invoice|receipt|payment\s+method|login|password|khata)\b/i,
  },
  // Broadest of the specific intents, so it is matched last.
  {
    intent: "SERVICE_SEARCH",
    name: "service_search",
    pattern: /\b(clean\w*|plumb\w*|electric\w*|carpent\w*|paint\w*|pest|salon|saloon|spa|appliance|ac\b|a\/c|fridge|washing\s+machine|geyser|sofa|kitchen|bathroom|book\s+a|need\s+a|want\s+a|looking\s+for|service[s]?\b|chahiye|karwana|karana|safai|marammat)\b/i,
  },
];

export function classifyIntent(message: string): IntentResult {
  const text = (message ?? "").trim();
  if (text.length === 0) return { intent: "GENERAL", confidence: 0, rule: "empty" };

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { intent: rule.intent, confidence: 1, rule: rule.name };
    }
  }
  return { intent: "GENERAL", confidence: 0, rule: "fallback" };
}

/** Every intent, for metric pre-seeding and policy table completeness checks. */
export const ALL_INTENTS: AiIntent[] = [
  "SERVICE_SEARCH",
  "PRICING_INQUIRY",
  "BOOKING_STATUS",
  "CANCEL_RESCHEDULE",
  "COMPLAINT",
  "ACCOUNT",
  "GENERAL",
];
