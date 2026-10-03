import { normalizeEmail, normalizePhone } from "./pii-normalize";
import { devAffordancesAllowed } from "./deployed-environment";

/**
 * Customer → partner dispatch PREFERENCE, for local development and test runs only.
 *
 * W2-D2. This module used to be a bypass, not a preference:
 *
 *   * it shipped a hardcoded default mapping a personal e-mail (and a typo'd copy of it) to a
 *     personal phone number, active on every host including production;
 *   * a pinned partner was never matched — it was SYNTHESISED with a score of 10,000, pushed to the
 *     front, and forced dispatch into broadcast mode;
 *   * at offer time it could skip OFFLINE, PAUSED, STALE_PRESENCE, STALE_LOCATION,
 *     OUTSIDE_SERVICE_AREA, NO_CAPACITY, CAPACITY_LIMIT, CONFLICT and SKILL_MISMATCH;
 *   * at accept time it WROTE a fresh heartbeat and location timestamp for a stale partner;
 *   * at arrive/start it substituted the job address for the partner's GPS, so a partner who was
 *     nowhere near the job could still be recorded as arrived.
 *
 * What it is now, and nothing more:
 *
 *   * **No default.** The mapping comes only from `DISPATCH_MUST_INCLUDE`; there is no fallback.
 *   * **Never on a deployed host.** `devAffordancesAllowed()` is false for production and staging,
 *     and a pin there resolves to nothing, whatever the environment variable says.
 *   * **Soft preference only.** A pinned partner is moved to the front of the list ONLY if they are
 *     already in it — that is, only if they passed every hard gate matching applies. A partner who
 *     failed a gate is not offered, pinned or not. Nothing is bypassed and nothing is fabricated.
 *
 * Override (development/test only):
 *   DISPATCH_MUST_INCLUDE='{"customer@example.test":["+919800000000"]}'
 */
export const DEFAULT_DISPATCH_MUST_INCLUDE: Readonly<Record<string, string[]>> = Object.freeze({});

export function canonicalDispatchEmail(email: string): string {
  return normalizeEmail(email);
}

/**
 * Parse the pin map. Returns an EMPTY map on any deployed host, and when the variable is absent or
 * malformed. There is deliberately no fallback mapping: a missing configuration must mean "no
 * preference", never "someone's hardcoded preference".
 */
export function parseDispatchMustInclude(
  raw: string | undefined,
  opts: { allowed?: boolean } = {},
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const allowed = opts.allowed ?? devAffordancesAllowed();
  if (!allowed) return map;
  const source = parseJsonPins(raw);
  if (!source) return map;
  for (const [email, phones] of Object.entries(source)) {
    if (!email || !Array.isArray(phones)) continue;
    const key = canonicalDispatchEmail(email);
    const normalized = phones.map(normalizePhone).filter(Boolean);
    if (normalized.length === 0) continue;
    const existing = map.get(key) ?? [];
    map.set(key, [...new Set([...existing, ...normalized])]);
  }
  return map;
}

function parseJsonPins(raw: string | undefined): Record<string, string[]> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string[]>;
  } catch {
    return null;
  }
}

export function mustIncludePhonesForEmail(
  email: string,
  pins: Map<string, string[]> = parseDispatchMustInclude(process.env.DISPATCH_MUST_INCLUDE),
): string[] {
  return pins.get(canonicalDispatchEmail(email)) ?? [];
}

/**
 * Reorder an ALREADY-ELIGIBLE, already-ranked list so pinned partners come first.
 *
 * The whole safety property is in what this function cannot do: it never adds a provider. A pinned
 * id that is not present in `ranked` stays absent, because its absence means it failed a hard gate
 * — offline, stale, out of area, at capacity, double-booked, or without the skill. Order within the
 * pinned group and within the rest is preserved, so the result stays deterministic.
 */
export function preferPinnedAmongEligible<T extends { providerId: string }>(
  ranked: readonly T[],
  pinnedIds: ReadonlySet<string>,
): T[] {
  if (pinnedIds.size === 0) return [...ranked];
  const pinned = ranked.filter((m) => pinnedIds.has(m.providerId));
  const rest = ranked.filter((m) => !pinnedIds.has(m.providerId));
  return [...pinned, ...rest];
}
