/**
 * Phase 2 — single authoritative dispatch eligibility boundary.
 *
 * Server-derived only. Never trusts client dispatchEligible / presenceState claims.
 * Uses Phase 1 canonical freshness (Postgres PartnerPresence); Redis is not required
 * for dispatch decisions — fail-safe when evidence is missing or stale.
 */
import prisma from "../lib/prisma";
import { isDispatchEligibleLifecycle } from "../lib/partner-lifecycle-fsm";
import { isPresenceFresh, isLocationFresh } from "../lib/partner-presence-freshness";
import { incCounter } from "../lib/metrics";
import { redisClient } from "../lib/redis";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildPartnerDispatchEligibilityChangedEvent } from "../events/catalog/partner.events";
import type { Prisma } from "@prisma/client";
import type {
  DispatchEligibilityReason,
  DispatchEligibilityResult,
  DispatchEligibilitySnapshot,
  DispatchEligibilityChecks,
  ZoneSupplyLevel,
  ZoneSupplySnapshot,
  AdminAssignmentOverride,
  AssignmentJobContext,
} from "../lib/dispatch-eligibility.types";

export type { DispatchEligibilityResult, DispatchEligibilitySnapshot, ZoneSupplySnapshot, AdminAssignmentOverride, AssignmentJobContext };

const lastEligibilityMem = new Map<string, boolean>();
const ELIGIBILITY_STATE_KEY = (providerId: string) => `dispatch:elig:state:${providerId}`;
const ELIGIBILITY_STATE_TTL_SEC = 86400;

const EMPTY_CHECKS = (): DispatchEligibilityChecks => ({
  lifecycle: false,
  availability: false,
  presence: false,
  location: false,
  capacity: true,
  schedule: true,
  geo: true,
  skill: true,
  risk: true,
  payment: true,
  conflict: true,
});

function isValidCoord(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

/**
 * Pure evaluation — no I/O. All paths should funnel through this.
 */
export function evaluateDispatchEligibility(
  snap: DispatchEligibilitySnapshot,
  now: Date = new Date(),
): DispatchEligibilityResult {
  const reasons: DispatchEligibilityReason[] = [];
  const checks = EMPTY_CHECKS();

  if (snap.isBanned || !snap.isActive || snap.complianceRestricted) {
    reasons.push("ACCOUNT_RESTRICTED");
  } else {
    checks.lifecycle = isDispatchEligibleLifecycle(snap.lifecycleState);
    if (!checks.lifecycle) reasons.push("NOT_ACTIVE");

    if (!snap.isApproved) reasons.push("APPROVAL_PENDING");
  }

  checks.availability = snap.isOnline && snap.pausedAt == null;
  if (!checks.availability) reasons.push("NOT_AVAILABLE");

  checks.presence = isPresenceFresh({ lastHeartbeatAt: snap.lastHeartbeatAt, now });
  if (!checks.presence) reasons.push("STALE_PRESENCE");

  const coordsOk = isValidCoord(snap.lastLocationLat, snap.lastLocationLng);
  checks.location = isLocationFresh({ lastLocationAt: snap.lastLocationAt, now }) && coordsOk;
  if (!coordsOk && snap.lastLocationAt) reasons.push("LOCATION_INVALID");
  else if (!checks.location) reasons.push("STALE_LOCATION");

  if (snap.capacityOk === false) {
    checks.capacity = false;
    reasons.push("NO_CAPACITY");
  }
  if (snap.scheduleOk === false) {
    checks.schedule = false;
    reasons.push("SCHEDULE_BLOCKED");
  }
  if (snap.geoOk === false) {
    checks.geo = false;
    reasons.push("OUTSIDE_SERVICE_AREA");
  }
  if (snap.skillMatch === false) {
    checks.skill = false;
    reasons.push("SKILL_MISMATCH");
  }
  if (snap.riskBlocked === true) {
    checks.risk = false;
    reasons.push("RISK_BLOCKED");
  }
  if (snap.paymentReady === false) {
    checks.payment = false;
    reasons.push("PAYMENT_NOT_READY");
  }
  if (snap.hasConflict === true) {
    checks.conflict = false;
    reasons.push("CONFLICT");
  }

  const eligible = Object.values(checks).every(Boolean) && reasons.length === 0;
  return { eligible, reasons, checks };
}

/** Machine code for assertOfferEligible — first failing gate. */
export function dispatchEligibilityBlockCode(result: DispatchEligibilityResult): string | null {
  if (result.eligible) return null;
  const order: DispatchEligibilityReason[] = [
    "NOT_FOUND",
    "ACCOUNT_RESTRICTED",
    "APPROVAL_PENDING",
    "NOT_ACTIVE",
    "NOT_AVAILABLE",
    "STALE_PRESENCE",
    "STALE_LOCATION",
    "LOCATION_INVALID",
    "SCHEDULE_BLOCKED",
    "OUTSIDE_SERVICE_AREA",
    "NO_CAPACITY",
    "CONFLICT",
    "SKILL_MISMATCH",
    "RISK_BLOCKED",
    "PAYMENT_NOT_READY",
  ];
  for (const code of order) {
    if (result.reasons.includes(code)) return code;
  }
  return result.reasons[0] ?? "NOT_AVAILABLE";
}

export async function loadPresenceEvidence(providerIds: string[]): Promise<
  Map<
    string,
    {
      lastHeartbeatAt: Date | null;
      lastLocationAt: Date | null;
      lastLocationLat: number | null;
      lastLocationLng: number | null;
    }
  >
> {
  if (providerIds.length === 0) return new Map();
  const rows = await prisma.partnerPresence.findMany({
    where: { providerId: { in: providerIds } },
    select: {
      providerId: true,
      lastHeartbeatAt: true,
      lastLocationAt: true,
      lastLocationLat: true,
      lastLocationLng: true,
    },
  });
  const map = new Map<
    string,
    {
      lastHeartbeatAt: Date | null;
      lastLocationAt: Date | null;
      lastLocationLat: number | null;
      lastLocationLng: number | null;
    }
  >();
  for (const r of rows) {
    map.set(r.providerId, {
      lastHeartbeatAt: r.lastHeartbeatAt,
      lastLocationAt: r.lastLocationAt,
      lastLocationLat: r.lastLocationLat,
      lastLocationLng: r.lastLocationLng,
    });
  }
  return map;
}

export async function isDispatchEligible(
  snap: DispatchEligibilitySnapshot,
  now?: Date,
): Promise<DispatchEligibilityResult> {
  const result = evaluateDispatchEligibility(snap, now);
  if (!result.eligible) {
    incCounter("dispatch_eligibility_reject_total", { reason: result.reasons[0] ?? "unknown" });
  } else {
    incCounter("dispatch_eligibility_pass_total");
  }
  return result;
}

/** Presence + location gate for matching (lifecycle/account gates already in SQL WHERE). */
export function passesPresenceLocationGate(
  evidence: {
    lastHeartbeatAt: Date | null;
    lastLocationAt: Date | null;
    lastLocationLat: number | null;
    lastLocationLng: number | null;
  } | null,
  now: Date = new Date(),
): boolean {
  const snap: DispatchEligibilitySnapshot = {
    providerId: "",
    lifecycleState: "ACTIVE",
    isActive: true,
    isApproved: true,
    isBanned: false,
    complianceRestricted: false,
    isOnline: true,
    pausedAt: null,
    lastHeartbeatAt: evidence?.lastHeartbeatAt ?? null,
    lastLocationAt: evidence?.lastLocationAt ?? null,
    lastLocationLat: evidence?.lastLocationLat ?? null,
    lastLocationLng: evidence?.lastLocationLng ?? null,
  };
  const { checks } = evaluateDispatchEligibility(snap, now);
  return checks.presence && checks.location;
}

/** Deterministic zone supply confidence — no ML. */
export function deriveZoneSupplyConfidence(input: {
  activePartners: number;
  availablePartners: number;
  livePartners: number;
  freshLocationPartners: number;
}): ZoneSupplySnapshot {
  const { activePartners, availablePartners, livePartners, freshLocationPartners } = input;
  const busyPartners = Math.max(0, activePartners - availablePartners);
  const capacityRemaining = freshLocationPartners;

  let confidence: ZoneSupplyLevel = "NONE";
  if (freshLocationPartners >= 3 && livePartners >= 3) confidence = "HIGH";
  else if (freshLocationPartners >= 1 && livePartners >= 1) confidence = "MEDIUM";
  else if (activePartners >= 1) confidence = "LOW";

  let customerLabel: ZoneSupplySnapshot["customerLabel"] = "Unavailable";
  if (confidence === "HIGH") customerLabel = "Available now";
  else if (confidence === "MEDIUM") customerLabel = "Limited availability";
  else if (confidence === "LOW") customerLabel = "Confirming professional";

  return {
    activePartners,
    availablePartners,
    livePartners,
    freshLocationPartners,
    busyPartners,
    capacityRemaining,
    nextAvailableAt: null,
    confidence,
    customerLabel,
  };
}

/**
 * Customer-facing "available now" for a single partner card.
 *
 * Only the mandatory first gates — no job-specific geo/skill — because a browse
 * card has no booking yet. Job-specific gates still run at match and offer time.
 * Never returns raw telemetry; callers should expose `availableNow` / `availabilityLabel` only.
 */
export function customerAvailableNow(snap: DispatchEligibilitySnapshot, now = new Date()): {
  availableNow: boolean;
  availabilityLabel: ZoneSupplySnapshot["customerLabel"];
} {
  const result = evaluateDispatchEligibility(snap, now);
  if (result.checks.lifecycle && result.checks.availability && result.checks.presence && result.checks.location) {
    return { availableNow: true, availabilityLabel: "Available now" };
  }
  if (result.checks.lifecycle) {
    return { availableNow: false, availabilityLabel: "Confirming professional" };
  }
  return { availableNow: false, availabilityLabel: "Unavailable" };
}

const PRESENCE_LOCATION_BLOCKS = new Set(["STALE_PRESENCE", "STALE_LOCATION", "LOCATION_INVALID"]);

export function isPresenceLocationOnlyBlock(code: string | null): boolean {
  return code != null && PRESENCE_LOCATION_BLOCKS.has(code);
}

/** Load provider + presence evidence for eligibility transition tracking. */
export async function loadProviderEligibilitySnapshot(
  providerId: string,
): Promise<DispatchEligibilitySnapshot | null> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      lifecycleState: true,
      isActive: true,
      isApproved: true,
      isBanned: true,
      complianceRestricted: true,
      isOnline: true,
      pausedAt: true,
    },
  });
  if (!provider) return null;
  const presence = await prisma.partnerPresence.findUnique({
    where: { providerId },
    select: {
      lastHeartbeatAt: true,
      lastLocationAt: true,
      lastLocationLat: true,
      lastLocationLng: true,
    },
  });
  return {
    providerId: provider.id,
    lifecycleState: provider.lifecycleState,
    isActive: provider.isActive,
    isApproved: provider.isApproved,
    isBanned: provider.isBanned,
    // Real state (was hard-coded false): a compliance-restricted partner is NOT dispatch-eligible,
    // and the eligibility-changed event must say so.
    complianceRestricted: provider.complianceRestricted,
    isOnline: provider.isOnline,
    pausedAt: provider.pausedAt,
    lastHeartbeatAt: presence?.lastHeartbeatAt ?? null,
    lastLocationAt: presence?.lastLocationAt ?? null,
    lastLocationLat: presence?.lastLocationLat ?? null,
    lastLocationLng: presence?.lastLocationLng ?? null,
  };
}

async function readStoredEligibility(providerId: string): Promise<boolean | null> {
  try {
    const raw = await redisClient.get(ELIGIBILITY_STATE_KEY(providerId));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* redis optional for transition dedupe */
  }
  return lastEligibilityMem.get(providerId) ?? null;
}

async function writeStoredEligibility(providerId: string, eligible: boolean): Promise<void> {
  lastEligibilityMem.set(providerId, eligible);
  try {
    // `set` takes the TTL directly; the node-redis-style extra "EX" argument made every
    // write throw into the catch below, so this key never actually reached Redis and the
    // transition de-dupe silently degraded to per-process memory.
    await redisClient.set(ELIGIBILITY_STATE_KEY(providerId), eligible ? "1" : "0", ELIGIBILITY_STATE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

/**
 * Emit partner.dispatch_eligibility.changed only on ELIGIBLE ↔ NOT_ELIGIBLE transitions.
 * Never emit per heartbeat when state is unchanged.
 */
export async function notifyEligibilityTransitionIfChanged(
  providerId: string,
  result: DispatchEligibilityResult,
  opts?: { tx?: Prisma.TransactionClient; bookingId?: string; correlationId?: string; requestId?: string },
): Promise<void> {
  const eligible = result.eligible;
  const previous = await readStoredEligibility(providerId);
  if (previous === eligible) return;

  await writeStoredEligibility(providerId, eligible);

  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.partnerEventsEnabled) return;

  const payload = {
    providerId,
    eligible,
    reasons: result.reasons,
    changedAt: new Date().toISOString(),
    bookingId: opts?.bookingId,
    correlationId: opts?.correlationId,
    requestId: opts?.requestId,
    previousEligible: previous ?? undefined,
  };

  const emit = async (tx: Prisma.TransactionClient) => {
    await emitInTransaction(tx, buildPartnerDispatchEligibilityChangedEvent(payload));
  };

  if (opts?.tx) {
    await emit(opts.tx);
  } else {
    await prisma.$transaction(emit);
  }
}

/** Evaluate + track eligibility transition (fire-and-forget safe from heartbeat). */
export async function trackProviderEligibilityTransition(
  providerId: string,
  now = new Date(),
  opts?: { correlationId?: string; requestId?: string },
): Promise<DispatchEligibilityResult | null> {
  const snap = await loadProviderEligibilitySnapshot(providerId);
  if (!snap) return null;
  const result = evaluateDispatchEligibility(snap, now);
  await notifyEligibilityTransitionIfChanged(providerId, result, opts).catch(() => undefined);
  return result;
}

export const dispatchEligibilityService = {
  evaluate: evaluateDispatchEligibility,
  isDispatchEligible,
  loadPresenceEvidence,
  loadProviderEligibilitySnapshot,
  passesPresenceLocationGate,
  blockCode: dispatchEligibilityBlockCode,
  deriveZoneSupplyConfidence,
  customerAvailableNow,
  isPresenceLocationOnlyBlock,
  notifyEligibilityTransitionIfChanged,
  trackProviderEligibilityTransition,
};
