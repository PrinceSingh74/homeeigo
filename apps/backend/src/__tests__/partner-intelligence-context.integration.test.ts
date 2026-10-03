/**
 * PARTNER INTELLIGENCE — Item 1 context contract, against a real database.
 *
 * Runs on the ISOLATED `homigo_p39` database (schema clone created in Phase-8 P3-9), never
 * `homigo_db`. Every run aborts if that is not where it is connected, so a misconfigured
 * DATABASE_URL cannot quietly write partner rows into production data.
 *
 * The point of these tests is the thing hardest to keep true as a codebase grows: a signal that
 * could not be resolved must stay an explicit state and must never become `0`, `false`, `[]` or a
 * confident-looking default. An LLM will read this context and explain it to a partner; it has to
 * be able to tell "no demand" from "we could not ask".
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  partnerIntelligenceService,
  PARTNER_INTELLIGENCE_RULES_VERSION,
} from "../services/partner-intelligence.service";
import type { PartnerIntelligenceContext, Signal } from "../services/partner-intelligence.types";

const SIGNAL_KEYS = [
  "location",
  "demand",
  "supply",
  "surge",
  "weather",
  "jobs",
  "earnings",
  "performance",
  "zoneCandidates",
] as const;

type SignalKey = (typeof SIGNAL_KEYS)[number];

/**
 * `test.each` takes rows, and a row is a tuple of arguments — so a flat list of strings is not a
 * valid table. Wrapping each key in a one-element tuple is the shape it actually wants, and keeps
 * the key strongly typed in the callback instead of widening to `unknown`.
 */
const SIGNAL_ROWS: Array<[SignalKey]> = SIGNAL_KEYS.map((k) => [k]);

let providerBare = "";
let providerLive = "";
let providerExpired = "";
let ctxBare: PartnerIntelligenceContext;

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  const stamp = Date.now();
  const mk = async (tag: string, phone: string) => {
    const user = await prisma.user.create({
      data: {
        firstName: tag,
        lastName: "PI",
        password: "x",
        role: "VENDOR",
        phoneNumber: phone,
        email: tag + "@pi.test",
      },
    });
    const p = await prisma.provider.create({
      data: { userId: user.id, businessName: tag, isActive: true, isVerified: true },
    });
    return p.id;
  };

  providerBare = await mk("pi-bare-" + stamp, "+9198" + String(stamp).slice(-8));
  providerLive = await mk("pi-live-" + stamp, "+9197" + String(stamp).slice(-8));
  providerExpired = await mk("pi-exp-" + stamp, "+9196" + String(stamp).slice(-8));

  await prisma.location.create({
    data: { providerId: providerLive, latitude: 12.9716, longitude: 77.5946, accuracy: 8 },
  });
  await prisma.location.create({
    data: { providerId: providerExpired, latitude: 12.9716, longitude: 77.5946, accuracy: 8 },
  });
  // `lastUpdated` is @updatedAt, so age has to be forced past the expiry band directly.
  await prisma.$executeRawUnsafe(
    "UPDATE locations SET last_updated = NOW() - INTERVAL '3 hours' WHERE provider_id = $1",
    providerExpired,
  );

  ctxBare = (await partnerIntelligenceService.getContext(providerBare))!;
}, 120_000);

describe("PI Item 1 — every signal is well-formed", () => {
  test("a context is produced for a partner with no history at all", () => {
    expect(ctxBare).not.toBeNull();
    expect(ctxBare.partner.providerId).toBe(providerBare);
    expect(ctxBare.versions.rulesVersion).toBe(PARTNER_INTELLIGENCE_RULES_VERSION);
    expect(typeof ctxBare.generatedAt).toBe("string");
  });

  test("an unknown provider yields null, not an empty context", async () => {
    expect(await partnerIntelligenceService.getContext("does-not-exist")).toBeNull();
  });

  test.each(SIGNAL_ROWS)("%s carries a state, freshness and provenance", (key) => {
    const s = ctxBare[key] as Signal<unknown>;
    expect(["OK", "UNAVAILABLE", "STALE", "INSUFFICIENT_DATA", "MODEL_UNAVAILABLE"]).toContain(s.state);
    expect(["REAL_TIME", "NEAR_REAL_TIME", "HISTORICAL", "FORECAST", "STATIC", "UNKNOWN"]).toContain(
      s.freshness,
    );
    expect(s).toHaveProperty("confidence");
    expect(s).toHaveProperty("observedAt");
  });
});

describe("PI Item 1 — a missing signal never becomes a fabricated value", () => {
  test.each(SIGNAL_ROWS)("%s: not-OK means value is null and a reasonCode says why", (key) => {
    const s = ctxBare[key] as Signal<unknown>;
    if (s.state === "OK") return;
    // The core guarantee: no zero, no false, no empty array standing in for absence.
    expect(s.value).toBeNull();
    expect(typeof s.reasonCode).toBe("string");
    expect(s.reasonCode!.length).toBeGreaterThan(0);
  });

  test("a partner with no location gets UNAVAILABLE, not coordinates", () => {
    expect(ctxBare.location.state).toBe("UNAVAILABLE");
    expect(ctxBare.location.reasonCode).toBe("NO_LOCATION_ON_FILE");
    expect(ctxBare.location.value).toBeNull();
  });

  test("weather without a location is UNAVAILABLE, not the city centre's weather", () => {
    // Reporting a guessed location's weather as an observation is exactly the quiet fabrication
    // this contract exists to prevent.
    expect(ctxBare.weather.state).toBe("UNAVAILABLE");
    expect(ctxBare.weather.reasonCode).toBe("NO_LOCATION_FOR_WEATHER");
  });

  test("a partner with no earnings is INSUFFICIENT_DATA, not a row of zeroes", () => {
    expect(ctxBare.earnings.state).toBe("INSUFFICIENT_DATA");
    expect(ctxBare.earnings.reasonCode).toBe("NO_EARNINGS_HISTORY");
    expect(ctxBare.earnings.value).toBeNull();
  });

  test("no confidence is invented for a signal that has none", () => {
    for (const key of SIGNAL_KEYS) {
      const s = ctxBare[key] as Signal<unknown>;
      if (s.state !== "OK") expect(s.confidence).toBeNull();
    }
  });
});

describe("PI Item 1 — location freshness is graded, not boolean", () => {
  test("a fresh fix is LIVE and REAL_TIME", async () => {
    const ctx = (await partnerIntelligenceService.getContext(providerLive))!;
    expect(ctx.location.state).toBe("OK");
    expect(ctx.location.value!.freshnessState).toBe("LIVE");
    expect(ctx.location.freshness).toBe("REAL_TIME");
    expect(ctx.location.value!.ageSeconds).toBeLessThanOrEqual(60);
  });

  test("a three-hour-old fix is withheld as STALE rather than presented as current", async () => {
    const ctx = (await partnerIntelligenceService.getContext(providerExpired))!;
    expect(ctx.location.state).toBe("STALE");
    expect(ctx.location.reasonCode).toBe("LOCATION_EXPIRED");
    expect(ctx.location.value).toBeNull();
    // The observation time is still reported, so a consumer can say HOW old it was.
    expect(typeof ctx.location.observedAt).toBe("string");
  });

  test("zone distance stays null without a usable fix — never 0", async () => {
    const ctx = (await partnerIntelligenceService.getContext(providerExpired))!;
    if (ctx.zoneCandidates.state !== "OK") return;
    for (const z of ctx.zoneCandidates.value!) expect(z.distanceKm).toBeNull();
  });
});

describe("PI Item 1 — jobs and performance report reality", () => {
  test("a partner with no jobs reports zero counts as a real OK value", () => {
    // Zero jobs is a FACT here, not a missing signal — the distinction the contract turns on.
    expect(ctxBare.jobs.state).toBe("OK");
    expect(ctxBare.jobs.value!.activeCount).toBe(0);
    expect(ctxBare.jobs.value!.assigned).toEqual([]);
  });

  test("performance carries sampleSize so trend language can be gated", () => {
    if (ctxBare.performance.state !== "OK") return;
    expect(typeof ctxBare.performance.value!.sampleSize).toBe("number");
    expect(ctxBare.performance.value!.sampleSize).toBe(0);
  });
});

describe("PI Item 1 — isolation and determinism", () => {
  test("context is built for the requested partner only", async () => {
    const a = (await partnerIntelligenceService.getContext(providerLive))!;
    const b = (await partnerIntelligenceService.getContext(providerBare))!;
    expect(a.partner.providerId).toBe(providerLive);
    expect(b.partner.providerId).toBe(providerBare);
    // Partner-scoped sections must not bleed across partners.
    expect(a.location.state).toBe("OK");
    expect(b.location.state).toBe("UNAVAILABLE");
  });

  test("two consecutive builds agree on every signal state", async () => {
    const one = (await partnerIntelligenceService.getContext(providerBare))!;
    const two = (await partnerIntelligenceService.getContext(providerBare))!;
    for (const key of SIGNAL_KEYS) {
      expect((two[key] as Signal<unknown>).state).toBe((one[key] as Signal<unknown>).state);
    }
  });

  test("a model version is reported only when that model actually answered", () => {
    const demandVersion = ctxBare.versions.models.demand;
    if (ctxBare.demand.state === "OK") expect(typeof demandVersion).toBe("string");
    else expect(demandVersion).toBeNull();
  });
});
