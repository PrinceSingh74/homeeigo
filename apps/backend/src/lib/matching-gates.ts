/**
 * Phase 11 — the canonical matching hard gates. Pure module (no I/O).
 *
 * `matching.service.ts` is the one matcher; this file holds the decisions it makes about a single
 * candidate so they can be tested without a database and so the ranking code cannot drift from the
 * gate code (the availability score reads the same functions).
 *
 * Mandated order (a provider carries EVERY failing reason, listed in this order):
 *   1. PROVENANCE_INVALID           — provider population ≠ booking population (defence in depth;
 *                                     the candidate SQL already scopes the population).
 *   2. BUSINESS_NOT_AUTHORIZED      — business-owned service, no active membership.
 *   3. SERVICE_CAPABILITY_MISSING, SKILL_MISSING, CERTIFICATION_*, EQUIPMENT_MISSING,
 *      INSURANCE_INVALID, LANGUAGE_MISMATCH — `evaluateCapabilityGates`.
 *   4. PROVIDER_NOT_AVAILABLE       — offline / paused / outside working hours / in a break.
 *   5. LOCATION_GATE_FAILED         — position unknown, beyond the max distance, outside the
 *                                     provider's radius or declared service zones.
 *   6. PRESENCE_STALE               — heartbeat or GPS fix not fresh.
 *   7. CAPACITY_EXCEEDED            — concurrency / daily quota full.
 *
 * A same-window booking conflict is NOT a rejection: it has always halved the availability score
 * (20 → 10) and still does, so existing ranking is unchanged.
 */
import { isInBreakWindow, isWithinWorkingWindow, type ScheduleInput } from "./partner-ops-clock";
import { MIN_SERVICE_RADIUS_KM } from "./partner-capacity";
import type { CapabilityRejection, MatchingRejectionReason } from "./provider-capability";

export const MATCHING_GATE_ORDER: readonly MatchingRejectionReason[] = [
  "PROVENANCE_INVALID",
  "BUSINESS_NOT_AUTHORIZED",
  "SERVICE_CAPABILITY_MISSING",
  "SKILL_MISSING",
  "CERTIFICATION_MISSING",
  "CERTIFICATION_EXPIRED",
  "CERTIFICATION_UNVERIFIED",
  "EQUIPMENT_MISSING",
  "INSURANCE_INVALID",
  "LANGUAGE_MISMATCH",
  "PROVIDER_NOT_AVAILABLE",
  "LOCATION_GATE_FAILED",
  "PRESENCE_STALE",
  "CAPACITY_EXCEEDED",
] as const;

export type GateRejection = { reason: MatchingRejectionReason; detail: string };

/** Offline, paused, outside the working window for the job, or in a break right now. */
export function availabilityGate(
  p: { isOnline: boolean; pausedAt: Date | null } & ScheduleInput,
  scheduledDate: Date,
  now: Date = new Date(),
): string | null {
  if (!p.isOnline) return "offline";
  if (p.pausedAt) return "paused";
  if (!isWithinWorkingWindow(p, scheduledDate)) return "outside_working_hours";
  if (isInBreakWindow(p, now)) return "break_active";
  return null;
}

/**
 * Service radius and declared service zones. `distanceKm` null means the position is unknown and
 * cannot be shown to be inside any boundary.
 */
export function serviceAreaGate(
  p: { serviceRadiusKm: number | null; serviceRegions: string[]; hasOrigin: boolean },
  distanceKm: number | null,
  jobZoneNames: Set<string> | undefined,
): string | null {
  const radius = p.serviceRadiusKm;
  if (radius != null && radius >= MIN_SERVICE_RADIUS_KM) {
    if (!p.hasOrigin || distanceKm == null || distanceKm > radius) return "outside_service_radius";
  }
  if (p.serviceRegions.length > 0 && jobZoneNames && jobZoneNames.size > 0) {
    const wants = p.serviceRegions.map((r) => r.trim().toLowerCase()).filter(Boolean);
    const zoneHit = wants.some((w) => [...jobZoneNames].some((n) => n === w || n.includes(w) || w.includes(n)));
    if (!zoneHit) return "outside_service_zone";
  }
  return null;
}

/** Distance bound of the request (unknown distance never passes it). */
export function distanceBoundGate(distanceKm: number | null, maxDistanceKm: number): string | null {
  if (distanceKm == null) return "position_unknown";
  if (distanceKm > maxDistanceKm) return "beyond_max_distance";
  return null;
}

/**
 * Assemble one candidate's rejections in the mandated order. Every gate is evaluated (not only the
 * first) so an operator asking "why was nobody matched" sees the whole picture.
 */
export function evaluateMatchingGates(input: {
  providerIsBusiness: boolean;
  bookingIsBusiness: boolean;
  capability: CapabilityRejection[];
  notAvailable: string | null;
  location: string | null;
  presenceFresh: boolean;
  capacityFull: boolean;
}): GateRejection[] {
  const out: GateRejection[] = [];
  if (input.providerIsBusiness !== input.bookingIsBusiness) {
    out.push({ reason: "PROVENANCE_INVALID", detail: input.bookingIsBusiness ? "non_business_provider" : "business_provider" });
  }
  out.push(...input.capability);
  if (input.notAvailable) out.push({ reason: "PROVIDER_NOT_AVAILABLE", detail: input.notAvailable });
  if (input.location) out.push({ reason: "LOCATION_GATE_FAILED", detail: input.location });
  if (!input.presenceFresh) out.push({ reason: "PRESENCE_STALE", detail: "presence_or_location_stale" });
  if (input.capacityFull) out.push({ reason: "CAPACITY_EXCEEDED", detail: "capacity_full" });
  const rank = (r: MatchingRejectionReason) => MATCHING_GATE_ORDER.indexOf(r);
  // Stable sort: capability rejections of the same reason keep their requirement order.
  return out.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.reason) - rank(b.r.reason) || a.i - b.i).map((x) => x.r);
}

/** Per-reason tally for the decision record and metrics. A provider counts once per reason it carries. */
export function countRejections(rejections: Array<{ reasons: MatchingRejectionReason[] }>): Partial<Record<MatchingRejectionReason, number>> {
  const counts: Partial<Record<MatchingRejectionReason, number>> = {};
  for (const r of rejections) for (const reason of new Set(r.reasons)) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}
