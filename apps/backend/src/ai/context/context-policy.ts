import type { AiGatewayRole } from "@prisma/client";
import type { AiIntent } from "../intent/intent-classifier";

/**
 * What a request is allowed to load, decided by (role, intent) before any query runs.
 *
 * This is the authorization boundary for *data*, distinct from `authorization.ts` which
 * decides endpoint access. A customer asking about pricing has no business pulling
 * partner rosters, and a general chit-chat turn has no business pulling anything — so the
 * default is the empty scope and each intent opens only what it needs.
 */
export type ContextScope = {
  serviceCatalog: boolean;
  serviceability: boolean;
  providerAvailability: boolean;
  pricing: boolean;
  ownBookings: boolean;
  ownProfile: boolean;
};

const NOTHING: ContextScope = {
  serviceCatalog: false,
  serviceability: false,
  providerAvailability: false,
  pricing: false,
  ownBookings: false,
  ownProfile: false,
};

/**
 * Customer scopes. Every entry is a deliberate decision about least privilege:
 * `SERVICE_SEARCH` needs the catalogue and whether we actually serve the area;
 * `BOOKING_STATUS` needs the caller's own bookings and nothing about the catalogue.
 */
const CUSTOMER_SCOPES: Record<AiIntent, ContextScope> = {
  SERVICE_SEARCH: {
    ...NOTHING,
    serviceCatalog: true,
    serviceability: true,
    providerAvailability: true,
    pricing: true,
  },
  PRICING_INQUIRY: { ...NOTHING, serviceCatalog: true, pricing: true, serviceability: true },
  BOOKING_STATUS: { ...NOTHING, ownBookings: true },
  CANCEL_RESCHEDULE: { ...NOTHING, ownBookings: true },
  COMPLAINT: { ...NOTHING, ownBookings: true },
  ACCOUNT: { ...NOTHING, ownProfile: true },
  GENERAL: { ...NOTHING, serviceCatalog: true },
};

/**
 * Partner and admin keep their existing context path; this table exists so the customer
 * pipeline cannot accidentally widen for another role. Anything not listed gets NOTHING.
 */
export function contextPolicyFor(role: AiGatewayRole, intent: AiIntent): ContextScope {
  if (role === "CUSTOMER") return CUSTOMER_SCOPES[intent] ?? NOTHING;
  return NOTHING;
}

/**
 * Fields that may be sent to a provider, per entity.
 *
 * An allowlist rather than a denylist: a column added to `Service` or `Provider` later
 * cannot leak by default. Nothing here is personally identifying — no names, phone
 * numbers, addresses or exact coordinates.
 */
export const CONTEXT_FIELD_ALLOWLIST = {
  service: ["id", "name", "category", "basePrice", "durationMinutes"] as const,
  availability: ["category", "availableProviders", "typicalEtaMinutes"] as const,
  serviceability: ["city", "isServiceable"] as const,
  booking: ["id", "status", "scheduledAt", "serviceName"] as const,
} as const;

/** Applies an allowlist to a record, dropping everything not named. */
export function pickAllowed<T extends Record<string, unknown>>(
  row: T,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  }
  return out;
}

/**
 * Hard ceiling on how much context reaches a provider.
 *
 * Token estimates drift and a runaway catalogue query would otherwise inflate every
 * prompt — raising cost, latency and the blast radius of an injection hidden in data.
 * Sections are dropped whole, lowest priority first, so the model never receives a
 * half-truncated record it might read as fact.
 */
export const CONTEXT_LIMITS = {
  maxTotalChars: 4_000,
  maxCatalogItems: 8,
  maxBookings: 5,
} as const;

export type ContextSection = { name: string; content: string; priority: number };

export function enforceContextBudget(
  sections: ContextSection[],
  maxChars: number = CONTEXT_LIMITS.maxTotalChars,
): { kept: ContextSection[]; dropped: string[] } {
  const ordered = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: ContextSection[] = [];
  const dropped: string[] = [];
  let used = 0;

  for (const section of ordered) {
    if (used + section.content.length <= maxChars) {
      kept.push(section);
      used += section.content.length;
    } else {
      dropped.push(section.name);
    }
  }
  return { kept, dropped };
}
