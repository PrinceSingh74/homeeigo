import { normalizeEmail, normalizePhone } from "./pii-normalize";

/**
 * Customer → partner phone pins for dispatch.
 *
 * Location-qualified partners still receive the broadcast offer. These partners
 * are force-included at the front of the offer list so they cannot be dropped
 * by distance, presence freshness, ranking cutoff, or offline matching.
 *
 * Override with DISPATCH_MUST_INCLUDE JSON:
 *   {"customer@email.com":["+919876543211"]}
 */
export const DEFAULT_DISPATCH_MUST_INCLUDE: Record<string, string[]> = {
  "princesingh40343@gmail.com": ["+919876543211"],
  "princesingh40343@gamil.com": ["+919876543211"],
};

/** Offer-time gates that a pinned partner may skip. Lifecycle / ban / approval still apply. */
export const MUST_INCLUDE_BYPASS_BLOCKS = new Set([
  "OFFLINE",
  "PAUSED",
  "STALE_PRESENCE",
  "STALE_LOCATION",
  "LOCATION_INVALID",
  "NOT_AVAILABLE",
  "SCHEDULE_BLOCKED",
  "OUTSIDE_WORKING_HOURS",
  "BREAK_ACTIVE",
  "OUTSIDE_SERVICE_AREA",
  "LOCATION_REQUIRED",
  "NO_CAPACITY",
  "CAPACITY_LIMIT",
  "CONFLICT",
  "SKILL_MISMATCH",
]);

/**
 * When a pinned partner's GPS is missing or outside the arrival radius,
 * substitute the job address so Arrive/Start can proceed. Unpinned partners
 * still fail with the original proximity error.
 */
export function applyMustIncludeProximityBypass(opts: {
  ok: boolean;
  error?: string | null;
  pinned: boolean;
  latitude: number;
  longitude: number;
  jobLatitude?: number | null;
  jobLongitude?: number | null;
}): { ok: true; latitude: number; longitude: number } | { ok: false; error: string } {
  if (opts.ok) return { ok: true, latitude: opts.latitude, longitude: opts.longitude };
  const code = opts.error ?? "LOCATION_REQUIRED";
  if (!opts.pinned || !canBypassMustIncludeBlock(code)) {
    return { ok: false, error: code };
  }
  const jobLat = opts.jobLatitude;
  const jobLng = opts.jobLongitude;
  if (
    jobLat != null &&
    jobLng != null &&
    Number.isFinite(jobLat) &&
    Number.isFinite(jobLng) &&
    !(jobLat === 0 && jobLng === 0)
  ) {
    return { ok: true, latitude: jobLat, longitude: jobLng };
  }
  return { ok: true, latitude: opts.latitude, longitude: opts.longitude };
}

export function canonicalDispatchEmail(email: string): string {
  return normalizeEmail(email)
    .replace(/@gamil\.com$/, "@gmail.com")
    .replace(/@gmial\.com$/, "@gmail.com");
}

export function parseDispatchMustInclude(
  raw: string | undefined,
  fallback: Record<string, string[]> = DEFAULT_DISPATCH_MUST_INCLUDE,
): Map<string, string[]> {
  const source = parseJsonPins(raw) ?? fallback;
  const map = new Map<string, string[]>();
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

export function mergeMustIncludeFront<T extends { providerId: string }>(
  eligible: T[],
  mustInclude: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...mustInclude, ...eligible]) {
    if (seen.has(row.providerId)) continue;
    seen.add(row.providerId);
    out.push(row);
  }
  return out;
}

export function canBypassMustIncludeBlock(code: string | null | undefined): boolean {
  return Boolean(code && MUST_INCLUDE_BYPASS_BLOCKS.has(code));
}
