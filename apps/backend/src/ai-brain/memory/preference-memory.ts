import type { AiGatewayRole } from "@prisma/client";
import { storeMemory, retrieveMemories, MemoryRejectedError } from "./memory-engine";
import { recordPreferenceLearned } from "../../lib/ai-brain-metrics";
import { logger } from "../../lib/logger";

/**
 * Durable preferences learned from conversation.
 *
 * Extraction is rule-based, not model-based. A model asked to "extract preferences" is a
 * direct path from user text into stored state that is replayed into every future prompt —
 * the exact persistence an injection wants. Rules can only ever produce values from the
 * closed sets below, so a hostile message cannot author a memory.
 */
export type PreferenceKind =
  | "language"
  | "preferred_time"
  | "service_affinity"
  | "budget_sensitivity"
  | "communication_style";

export type LearnedPreference = {
  kind: PreferenceKind;
  /** Always drawn from a fixed vocabulary — never free text from the user. */
  value: string;
  confidence: number;
};

const LANGUAGE_RULES: Array<[RegExp, string]> = [
  // Devanagari, or common romanised Hindi markers.
  [/[ऀ-ॿ]/, "hi"],
  [/\b(chahiye|karwana|karana|kitna|kripya|dhanyavaad|nahi|hai|bhai|kar do)\b/i, "hinglish"],
];

const TIME_RULES: Array<[RegExp, string]> = [
  [/\b(morning|subah|before noon|am\b)\b/i, "morning"],
  [/\b(afternoon|dopahar)\b/i, "afternoon"],
  [/\b(evening|shaam|after work)\b/i, "evening"],
  [/\b(weekend|saturday|sunday|shanivar|ravivar)\b/i, "weekend"],
];

const BUDGET_RULES: Array<[RegExp, string]> = [
  [/\b(cheap|cheapest|budget|sasta|kam paise|affordable|low cost)\b/i, "value_seeking"],
  [/\b(best|premium|top rated|quality|acha wala|professional)\b/i, "quality_seeking"],
];

const SERVICE_RULES: Array<[RegExp, string]> = [
  [/\bclean\w*|safai|kitchen|bathroom|sofa\b/i, "cleaning"],
  [/\bsalon|spa|beauty|grooming\b/i, "beauty"],
  [/\brepair|fix|marammat|appliance\b/i, "repair"],
];

function firstMatch(rules: Array<[RegExp, string]>, text: string): string | undefined {
  for (const [pattern, value] of rules) if (pattern.test(text)) return value;
  return undefined;
}

/** Extracts preferences from one turn. Returns [] when nothing is confidently inferable. */
export function extractPreferences(message: string): LearnedPreference[] {
  const out: LearnedPreference[] = [];
  const text = message ?? "";

  const language = firstMatch(LANGUAGE_RULES, text);
  if (language) out.push({ kind: "language", value: language, confidence: 0.9 });

  const time = firstMatch(TIME_RULES, text);
  if (time) out.push({ kind: "preferred_time", value: time, confidence: 0.7 });

  const budget = firstMatch(BUDGET_RULES, text);
  if (budget) out.push({ kind: "budget_sensitivity", value: budget, confidence: 0.6 });

  const service = firstMatch(SERVICE_RULES, text);
  if (service) out.push({ kind: "service_affinity", value: service, confidence: 0.5 });

  return out;
}

/**
 * Persists learned preferences for one actor.
 *
 * Never throws into the request path: a preference is a nice-to-have, and failing a
 * customer's answer because a background write was refused would be the wrong trade.
 * Rejections are counted and logged instead.
 */
export async function learnPreferences(params: {
  actorId: string;
  actorRole: AiGatewayRole;
  message: string;
}): Promise<LearnedPreference[]> {
  const preferences = extractPreferences(params.message);
  if (preferences.length === 0) return [];

  await Promise.all(
    preferences.map(async (pref) => {
      try {
        await storeMemory({
          memoryKey: `preference:${pref.kind}`,
          ownerId: params.actorId,
          memoryType: "SEMANTIC",
          content: { kind: pref.kind, value: pref.value },
          summary: `${pref.kind}=${pref.value}`,
          importance: pref.confidence,
        });
        recordPreferenceLearned(params.actorRole, pref.kind);
      } catch (err) {
        // A refused write is a signal, not a request failure.
        logger.warn("ai_preference_write_rejected", {
          category: "APPLICATION",
          actorRole: params.actorRole,
          kind: pref.kind,
          reason: err instanceof MemoryRejectedError ? err.reason : "unknown",
        });
      }
    }),
  );

  return preferences;
}

/** Reads back an actor's stored preferences. Owner-scoped by construction. */
export async function loadPreferences(actorId: string): Promise<Record<string, string>> {
  const rows = await retrieveMemories({
    ownerId: actorId,
    memoryType: "SEMANTIC",
    limit: 20,
  });

  const out: Record<string, string> = {};
  for (const row of rows) {
    const content = row.content as { kind?: string; value?: string } | null;
    if (content?.kind && content.value) out[content.kind] = content.value;
  }
  return out;
}

/**
 * Partner operational memory — durable facts about how a partner works.
 *
 * Kept separate from customer preferences because the vocabulary, the owner and the
 * retention expectations all differ; sharing one bag would make a partner's operating
 * pattern reachable from a customer-scoped query.
 */
export type PartnerOperationalFact =
  | "prefers_short_trips"
  | "prefers_high_value_jobs"
  | "works_weekends"
  | "declines_late_night";

export async function recordPartnerOperationalFact(params: {
  partnerId: string;
  fact: PartnerOperationalFact;
  confidence?: number;
}): Promise<void> {
  try {
    await storeMemory({
      memoryKey: `partner_ops:${params.fact}`,
      ownerId: params.partnerId,
      memoryType: "WORKING",
      content: { fact: params.fact },
      summary: `partner_ops:${params.fact}`,
      importance: params.confidence ?? 0.6,
    });
    recordPreferenceLearned("PARTNER", params.fact);
  } catch (err) {
    logger.warn("ai_partner_fact_rejected", {
      category: "APPLICATION",
      fact: params.fact,
      reason: err instanceof MemoryRejectedError ? err.reason : "unknown",
    });
  }
}
