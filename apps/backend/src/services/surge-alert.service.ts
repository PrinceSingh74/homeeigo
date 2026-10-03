import { geoIntelligenceService } from "./geo-intelligence.service";
import { logger } from "../lib/logger";
import {
  surgeAlertPolicy,
  isSurgeAlertPolicyApproved,
  surgePolicyRefusal,
  SURGE_POLICY_REFUSAL,
} from "./surge-alert-policy.config";
import type { SurgeAlertPolicy } from "./surge-alert-policy.config";

/**
 * Surge Automation (Item 7) — reads the authoritative surge signal, decides nothing yet.
 *
 * ── What is and is not authoritative ───────────────────────────────────────────
 *
 * `geoIntelligenceService.surgePrediction()` is the source, and it stays the source. This service
 * parses it, records its provenance and flags two anomalies the discovery pass measured — it does
 * not recompute, smooth, correct or second-guess a single number. The formula lives in
 * geo-intelligence and any change to it is a business decision made there, not a repair made here.
 *
 * ── This surge is not money ────────────────────────────────────────────────────
 *
 * Three different things are called surge in this platform, and only one reaches a payment:
 *
 *   weatherService.surgeMultiplier()  → booking-pricing → chargeableBase → MONEY
 *   geofence.surgeMultiplier          → geo-intelligence + a metrics gauge only
 *   surgePrediction().predictedSurge  → informational only
 *
 * `dynamicPricingService` has exactly one caller, `routes/pricing.ts`, and no part of booking
 * creation reads it. So a partner alert built on `predictedSurge` describes demand pressure, and a
 * partner who acted on it would earn nothing extra *because of the surge itself*. Every field below
 * is named for pressure and opportunity; there is deliberately no earnings field, no multiplier
 * presented as a rate, and nothing a template could render as a payout promise.
 */

export const SURGE_ALERT_RULES_VERSION = "surge.rules.v1";

/** The clamp ceilings inside the source formula, restated for detection only — never applied. */
const SOURCE_DEMAND_SURGE_CLAMP = 2.5;
const SOURCE_SURGE_CLAMP = 3;
/** Pressure at which the source's demandSurge saturates: 1 + (p-1)*0.4 = 2.5. */
const SOURCE_SATURATION_PRESSURE = 4.75;

export const SURGE_ANOMALY = {
  /**
   * The zero-supply discontinuity, measured 2026-08-29.
   *
   * The source reads `supply > 0 ? active/supply : (active > 0 ? 2 : 1)`. So a zone losing its last
   * provider moves from pressure `active/1` to a hardcoded 2 — Gurugram's surge falls from 3.00 to
   * 1.68 at the exact moment it becomes least able to serve anyone. Recorded, never corrected here.
   */
  ZERO_SUPPLY_SIGNAL_ANOMALY: "ZERO_SUPPLY_SIGNAL_ANOMALY",
  /**
   * The signal has hit a clamp and can no longer distinguish degrees of pressure above it.
   *
   * Noida at pressure 24 and Gurugram at pressure 5 both saturate. Reporting a saturated value as
   * though it were a measurement would make "busy" and "overwhelmed" the same number.
   */
  SIGNAL_SATURATED: "SIGNAL_SATURATED",
  /** Two active zones share a display name, so a name can never be an identity. */
  DUPLICATE_ZONE_NAME: "DUPLICATE_ZONE_NAME",
} as const;

export type SurgeAnomaly = (typeof SURGE_ANOMALY)[keyof typeof SURGE_ANOMALY];

/**
 * One zone's surge reading, with everything needed to explain it later.
 *
 * `zoneId` is the identity and `zoneName` is a label. The platform has two active zones both called
 * "Delhi Connaught Place" with different supply and different surge, so anything that grouped,
 * deduplicated or keyed on the name would silently merge two different places.
 */
export type ZoneSurgeReading = {
  zoneId: string;
  /** Display only. Never an identity, never an idempotency key. */
  zoneName: string;
  city: string | null;
  surge: number;
  supply: number;
  activeBookings: number;
  weatherSurge: number;
  /** `activeBookings / supply` as the source computes it, including its zero-supply branch. */
  pressure: number;
  anomalies: SurgeAnomaly[];
};

export type SurgeSignalState = "OK" | "STALE" | "UNAVAILABLE";

export type SurgeSignal = {
  state: SurgeSignalState;
  zones: ZoneSurgeReading[];
  /** Where the reading came from, verbatim from the source. */
  source: string | null;
  /** When the source computed it — not when this was read. */
  observedAt: string | null;
  confidence: number | null;
  /** Age of the reading in seconds, or null when the source gave no timestamp. */
  ageSeconds: number | null;
  reasonCode?: string;
  rulesVersion: string;
  generatedAt: string;
};

/**
 * How old a surge reading may be before it stops describing now.
 *
 * Anchored to the source's own 120 s response cache rather than chosen: a reading can legitimately
 * be up to one full cache window old, and anything beyond two windows is describing a state the
 * source itself would have recomputed by now. This is a freshness bound on a cached read, not a
 * business threshold — it decides whether a value is current, never whether it is alert-worthy.
 */
export const SURGE_SOURCE_CACHE_TTL_SEC = 120;
export const SURGE_STALE_AFTER_SEC = SURGE_SOURCE_CACHE_TTL_SEC * 2;

/**
 * What the automation would decide about one zone.
 *
 * `WOULD_NOT_EVALUATE` is the shipped outcome for every zone: with `threshold: null` there is
 * nothing to compare a surge against, so the honest classification is "no policy", not "below
 * threshold". Collapsing those two would make an undecided platform look like a calm one.
 */
export const SURGE_DECISION = {
  WOULD_NOT_EVALUATE: "WOULD_NOT_EVALUATE",
  ALERT_WORTHY: "ALERT_WORTHY",
  BELOW_THRESHOLD: "BELOW_THRESHOLD",
  SIGNAL_UNUSABLE: "SIGNAL_UNUSABLE",
} as const;

export type SurgeDecision = (typeof SURGE_DECISION)[keyof typeof SURGE_DECISION];

export type ZoneSurgeDecision = {
  zoneId: string;
  zoneName: string;
  decision: SurgeDecision;
  reasonCode: string;
  reading: ZoneSurgeReading | null;
  /** The policy values in force when this was decided, so a decision is reproducible. */
  policy: { threshold: number | null; hysteresis: number | null; status: string };
  signalState: SurgeSignalState;
  observedAt: string | null;
  confidence: number | null;
  rulesVersion: string;
};

export const surgeAlertService = {
  /**
   * Read the authoritative surge signal.
   *
   * Anomalies are attached per zone rather than raised, because they are properties of the reading
   * that a reader needs alongside the number — a saturated 2.88 and a measured 2.88 are different
   * facts wearing the same digits.
   */
  async readSignal(opts?: { now?: Date }): Promise<SurgeSignal> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();
    const base = {
      rulesVersion: SURGE_ALERT_RULES_VERSION,
      generatedAt,
    };

    let res: Awaited<ReturnType<typeof geoIntelligenceService.surgePrediction>>;
    try {
      res = await geoIntelligenceService.surgePrediction();
    } catch (err) {
      logger.warn("surge_signal_unavailable", { error: String(err).slice(0, 200) });
      return {
        ...base,
        state: "UNAVAILABLE",
        zones: [],
        source: null,
        observedAt: null,
        confidence: null,
        ageSeconds: null,
        reasonCode: "SURGE_SOURCE_ERROR",
      };
    }

    const rows = Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) {
      return {
        ...base,
        state: "UNAVAILABLE",
        zones: [],
        source: res.source ?? null,
        observedAt: res.freshness ?? null,
        confidence: res.confidence ?? null,
        ageSeconds: null,
        reasonCode: "SURGE_NO_ZONES",
      };
    }

    /**
     * Duplicate display names are detected across the whole reading, not per zone.
     *
     * A name is only ambiguous relative to the other names present, so this cannot be decided while
     * looking at one row. Both colliding zones are flagged — neither is the "real" one.
     */
    const nameCounts = new Map<string, number>();
    for (const r of rows) {
      const n = String(r.name ?? "");
      nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }

    const zones: ZoneSurgeReading[] = rows.map((r) => {
      const supply = Number(r.supply ?? 0);
      const activeBookings = Number(r.activeBookings ?? 0);
      const surge = Number(r.predictedSurge ?? 1);
      const zoneName = String(r.name ?? "");
      // Reproduces the source's own branch, including the zero-supply constant, for reporting only.
      const pressure = supply > 0 ? activeBookings / supply : activeBookings > 0 ? 2 : 1;

      const anomalies: SurgeAnomaly[] = [];
      if (supply === 0 && activeBookings > 0) anomalies.push(SURGE_ANOMALY.ZERO_SUPPLY_SIGNAL_ANOMALY);
      if (pressure >= SOURCE_SATURATION_PRESSURE || surge >= SOURCE_SURGE_CLAMP) {
        anomalies.push(SURGE_ANOMALY.SIGNAL_SATURATED);
      }
      if ((nameCounts.get(zoneName) ?? 0) > 1) anomalies.push(SURGE_ANOMALY.DUPLICATE_ZONE_NAME);

      return {
        zoneId: String(r.zoneId ?? ""),
        zoneName,
        city: r.city == null ? null : String(r.city),
        surge,
        supply,
        activeBookings,
        weatherSurge: Number(r.weatherSurge ?? 1),
        pressure,
        anomalies,
      };
    });

    const observedAt = res.freshness ?? null;
    const ageSeconds =
      observedAt && !Number.isNaN(Date.parse(observedAt))
        ? Math.max(0, Math.round((now.getTime() - Date.parse(observedAt)) / 1000))
        : null;

    const stale = ageSeconds === null || ageSeconds > SURGE_STALE_AFTER_SEC;

    return {
      ...base,
      state: stale ? "STALE" : "OK",
      zones,
      source: res.source ?? null,
      observedAt,
      confidence: res.confidence ?? null,
      ageSeconds,
      ...(stale
        ? { reasonCode: ageSeconds === null ? "SURGE_AGE_UNKNOWN" : "SURGE_SIGNAL_STALE" }
        : {}),
    };
  },

  /**
   * Classify every zone under the current policy.
   *
   * With the shipped policy this returns `WOULD_NOT_EVALUATE` for every zone and cannot return
   * `ALERT_WORTHY` for any — the threshold is null and there is nothing to compare against. That is
   * the intended shipped behaviour, and a test asserts it rather than trusting it.
   */
  async evaluate(opts?: {
    now?: Date;
    policy?: SurgeAlertPolicy;
  }): Promise<{ signal: SurgeSignal; decisions: ZoneSurgeDecision[]; refusal: string | null }> {
    const policy = opts?.policy ?? surgeAlertPolicy;
    const signal = await this.readSignal({ now: opts?.now });
    const refusal = surgePolicyRefusal(policy);
    const approved = isSurgeAlertPolicyApproved(policy);

    const policySnapshot = {
      threshold: policy.threshold,
      hysteresis: policy.hysteresis,
      status: policy.status,
    };

    const decisions: ZoneSurgeDecision[] = signal.zones.map((z) => {
      const common = {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        reading: z,
        policy: policySnapshot,
        signalState: signal.state,
        observedAt: signal.observedAt,
        confidence: signal.confidence,
        rulesVersion: SURGE_ALERT_RULES_VERSION,
      };

      if (!approved) {
        return { ...common, decision: SURGE_DECISION.WOULD_NOT_EVALUATE, reasonCode: SURGE_POLICY_REFUSAL };
      }
      /**
       * A stale or unavailable signal is never evaluated, even under an approved policy.
       *
       * Alerting on a reading whose age is unknown would be describing a past state as the present —
       * the same defect corrected in the morning brief's demand signal.
       */
      if (signal.state !== "OK") {
        return {
          ...common,
          decision: SURGE_DECISION.SIGNAL_UNUSABLE,
          reasonCode: signal.reasonCode ?? "SURGE_SIGNAL_UNUSABLE",
        };
      }
      const threshold = policy.threshold as number;
      return z.surge >= threshold
        ? { ...common, decision: SURGE_DECISION.ALERT_WORTHY, reasonCode: "SURGE_AT_OR_ABOVE_THRESHOLD" }
        : { ...common, decision: SURGE_DECISION.BELOW_THRESHOLD, reasonCode: "SURGE_BELOW_THRESHOLD" };
    });

    return { signal, decisions, refusal };
  },

  /**
   * The identity of one alert decision: partner, zone, state and workflow version.
   *
   * `zoneId` and never `zoneName`, because two active zones share a name and keying on it would let
   * one zone's alert suppress the other's. The surge value is deliberately absent — an identity that
   * changed every time the multiplier moved by 0.01 would defeat its own purpose.
   */
  alertIdentity(providerId: string, zoneId: string, decision: SurgeDecision, workflowVersion: number): string {
    return `surge:${providerId}:${zoneId}:${decision}:v${workflowVersion}`;
  },
};

export const SURGE_SOURCE_CLAMPS = {
  demandSurge: SOURCE_DEMAND_SURGE_CLAMP,
  surge: SOURCE_SURGE_CLAMP,
  saturationPressure: SOURCE_SATURATION_PRESSURE,
} as const;
