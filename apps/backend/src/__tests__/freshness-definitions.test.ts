import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEMAND_STALE_AFTER_HOURS,
  isDemandForecastStale,
} from "../lib/demand-forecast-freshness";
import {
  LOCATION_FRESH_SEC,
  PRESENCE_FRESH_SEC,
  PRESENCE_STALE_SEC,
  derivePresenceFreshness,
  deriveLocationFreshness,
  isLocationFresh,
  isPresenceFresh,
} from "../lib/partner-presence-freshness";

/**
 * 6D — there is one definition of "fresh" per domain, and each one is fail-closed.
 *
 * Two rules exist, and they are genuinely different questions rather than a duplicated one:
 *
 *   demand-forecast-freshness   Has the forecast's own HORIZON already elapsed? (24 h)
 *   partner-presence-freshness  How long since this partner's heartbeat / position? (30 s / 60 s)
 *
 * The first is about the window a forecast describes; the second is about the age of an observation.
 * Conflating them would be the real defect, so both are pinned here alongside a structural check
 * that no third definition has appeared.
 *
 * The cases below are the ones that decide whether a freshness rule is honest: a missing timestamp,
 * an unparseable one, a future one, and the exact boundary. An unknown age must never read as youth.
 */
const HOUR = 3_600_000;

function hourString(ms: number): string {
  // The warehouse emits "YYYY-MM-DD HH:00"; the rule appends Z and parses it as UTC.
  return new Date(ms).toISOString().slice(0, 13).replace("T", " ") + ":00";
}

describe("demand forecast staleness", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");

  test("a forecast whose last hour is still ahead is fresh", () => {
    const points = [{ hour: hourString(now + 6 * HOUR) }];
    expect(isDemandForecastStale(new Date(now).toISOString(), { points }, now)).toBe(false);
  });

  test("a forecast whose horizon elapsed long ago is stale, however recently it was fetched", () => {
    /**
     * The defect this rule exists for: ML.FORECAST projects from the end of TRAINING data, so a
     * model queried seconds ago can return points describing last June. Freshness of retrieval is
     * not freshness of content.
     */
    const points = [{ hour: hourString(now - 80 * 24 * HOUR) }];
    expect(isDemandForecastStale(new Date(now).toISOString(), { points }, now)).toBe(true);
  });

  test("the boundary is the threshold itself — older than 24 h, not 24 h or more", () => {
    const exactly = [{ hour: hourString(now - DEMAND_STALE_AFTER_HOURS * HOUR) }];
    const justPast = [{ hour: hourString(now - DEMAND_STALE_AFTER_HOURS * HOUR - HOUR) }];

    // `now - lastMs > threshold` — equality is not yet stale.
    expect(isDemandForecastStale(null, { points: exactly }, now)).toBe(false);
    expect(isDemandForecastStale(null, { points: justPast }, now)).toBe(true);
  });

  test("no points and no observedAt is STALE — an unknown age is not evidence of youth", () => {
    expect(isDemandForecastStale(null, null, now)).toBe(true);
    expect(isDemandForecastStale(null, { points: [] }, now)).toBe(true);
  });

  test("an unparseable horizon is stale rather than quietly fresh", () => {
    expect(isDemandForecastStale(null, { points: [{ hour: "not-a-time" }] }, now)).toBe(true);
  });

  test("a future horizon is fresh — clock skew must not be read as expiry", () => {
    const points = [{ hour: hourString(now + 48 * HOUR) }];
    expect(isDemandForecastStale(null, { points }, now)).toBe(false);
  });

  test("with no points it falls back to when the forecast was fetched", () => {
    const fresh = new Date(now - 2 * HOUR).toISOString();
    const old = new Date(now - (DEMAND_STALE_AFTER_HOURS + 2) * HOUR).toISOString();
    expect(isDemandForecastStale(fresh, { points: [] }, now)).toBe(false);
    expect(isDemandForecastStale(old, { points: [] }, now)).toBe(true);
  });

  test("the last point decides, not the first", () => {
    // A forecast that begins in the past but still runs into the future is not stale.
    const points = [{ hour: hourString(now - 40 * HOUR) }, { hour: hourString(now + 4 * HOUR) }];
    expect(isDemandForecastStale(null, { points }, now)).toBe(false);
  });
});

describe("partner presence and location freshness", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const agoSec = (s: number) => new Date(now.getTime() - s * 1000);

  test("a missing heartbeat is EXPIRED, never FRESH", () => {
    expect(derivePresenceFreshness({ lastHeartbeatAt: null, now })).toBe("EXPIRED");
    expect(isPresenceFresh({ lastHeartbeatAt: null, now })).toBe(false);
    expect(deriveLocationFreshness({ lastLocationAt: null, now })).toBe("EXPIRED");
    expect(isLocationFresh({ lastLocationAt: null, now })).toBe(false);
  });

  test("the fresh boundary is inclusive, and one second past it is not fresh", () => {
    expect(isPresenceFresh({ lastHeartbeatAt: agoSec(PRESENCE_FRESH_SEC), now })).toBe(true);
    expect(isPresenceFresh({ lastHeartbeatAt: agoSec(PRESENCE_FRESH_SEC + 1), now })).toBe(false);
    expect(isLocationFresh({ lastLocationAt: agoSec(LOCATION_FRESH_SEC), now })).toBe(true);
    expect(isLocationFresh({ lastLocationAt: agoSec(LOCATION_FRESH_SEC + 1), now })).toBe(false);
  });

  test("STALE sits between fresh and expired rather than collapsing into either", () => {
    expect(derivePresenceFreshness({ lastHeartbeatAt: agoSec(PRESENCE_FRESH_SEC + 1), now })).toBe("STALE");
    expect(derivePresenceFreshness({ lastHeartbeatAt: agoSec(PRESENCE_STALE_SEC), now })).toBe("STALE");
    expect(derivePresenceFreshness({ lastHeartbeatAt: agoSec(PRESENCE_STALE_SEC + 1), now })).toBe("EXPIRED");
  });

  test("an identical timestamp is fresh — zero age is the freshest possible", () => {
    expect(derivePresenceFreshness({ lastHeartbeatAt: now, now })).toBe("FRESH");
  });

  test("a future timestamp reads as fresh — clock skew must not evict a partner who is online", () => {
    /**
     * Device clocks drift, so a heartbeat can arrive stamped slightly ahead of the server.
     *
     * NOTE ON WHAT THIS DOES AND DOES NOT PROVE. The rule floors the age at zero, but every public
     * function here compares `age <= threshold`, and a negative age satisfies that just as a zero
     * one does — so removing the floor changes nothing observable through this module. An earlier
     * version of this test claimed to pin the floor and passed with the floor deleted, which is no
     * test at all. It now asserts only the reachable property: a future stamp is FRESH.
     */
    const future = new Date(now.getTime() + 5 * 60_000);
    expect(derivePresenceFreshness({ lastHeartbeatAt: future, now })).toBe("FRESH");
    expect(isLocationFresh({ lastLocationAt: future, now })).toBe(true);
  });
});

describe("no third definition of freshness exists", () => {
  /**
   * Structural, because a duplicate is introduced by writing a new function rather than by breaking
   * an existing one — nothing fails when a second rule appears, the two simply start disagreeing.
   */
  const SRC = join(import.meta.dir, "..");

  function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "__tests__") continue;
          walk(full);
        } else if (entry.endsWith(".ts")) {
          out.push(full);
        }
      }
    };
    walk(SRC);
    return out;
  }

  test("the scan reads the source tree", () => {
    // Positive control: an empty scan would otherwise report a clean bill of health.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith("partner-presence-freshness.ts"))).toBe(true);
  });

  test("each freshness rule is declared exactly once", () => {
    const files = sourceFiles();
    const declarations = (name: string) =>
      files.filter((f) => readFileSync(f, "utf8").includes(`export function ${name}`));

    for (const rule of [
      "isDemandForecastStale",
      "derivePresenceFreshness",
      "isPresenceFresh",
      "isLocationFresh",
      "deriveLocationFreshness",
    ]) {
      expect(`${rule}:${declarations(rule).length}`).toBe(`${rule}:1`);
    }
  });

  test("each freshness threshold is declared exactly once", () => {
    const files = sourceFiles();
    const declarations = (name: string) =>
      files.filter((f) => new RegExp(`(const|let)\\s+${name}\\s*=`).test(readFileSync(f, "utf8")));

    for (const threshold of ["DEMAND_STALE_AFTER_HOURS", "PRESENCE_FRESH_SEC", "PRESENCE_STALE_SEC", "LOCATION_FRESH_SEC"]) {
      expect(`${threshold}:${declarations(threshold).length}`).toBe(`${threshold}:1`);
    }
  });
});
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

describe("one threshold, restated nowhere", () => {
  /**
   * "A provider is live within 60 seconds" was declared four times: PRESENCE_TTL_SEC in
   * tracking.service AND in demand-supply-warning, LOCATION_LIVE_S in partner-intelligence, and the
   * env-tunable LOCATION_FRESH_SEC in the config. Only the last responded to configuration, so
   * setting PRESENCE_LOCATION_FRESH_SEC moved one of the four and silently left three at 60.
   *
   * The bands themselves are NOT unified — partner-intelligence answers "is this fix good enough to
   * advise with", the presence library answers "may this partner be dispatched", and those are
   * different questions off different tables. Only the shared anchor is.
   */
  const SERVICES = join(import.meta.dir, "..", "services");

  test("no service hardcodes the presence window", () => {
    for (const file of ["tracking.service.ts", "demand-supply-warning.service.ts", "partner-intelligence.service.ts"]) {
      // Comments stripped: prose describing the old literal is documentation, not a hardcoded value.
      const code = stripComments(readFileSync(join(SERVICES, file), "utf8"));
      expect(`${file}:${/PRESENCE_TTL_SEC\s*=\s*60\b/.test(code)}`).toBe(`${file}:false`);
      expect(`${file}:${/LOCATION_LIVE_S\s*=\s*60\b/.test(code)}`).toBe(`${file}:false`);
    }
  });

  test("each one imports the canonical constant instead", () => {
    const tracking = readFileSync(join(SERVICES, "tracking.service.ts"), "utf8");
    const demand = readFileSync(join(SERVICES, "demand-supply-warning.service.ts"), "utf8");
    const intel = readFileSync(join(SERVICES, "partner-intelligence.service.ts"), "utf8");

    expect(tracking).toContain("PRESENCE_STALE_SEC");
    expect(tracking).toContain("partner-presence.config");
    expect(demand).toContain("PRESENCE_STALE_SEC");
    expect(intel).toContain("LOCATION_FRESH_SEC");
    expect(intel).toContain("partner-presence.config");
  });

  test("the advisory bands remain this layer's own, not the dispatch gate's", () => {
    // Anchoring the LIVE band must not have collapsed the wider advisory vocabulary into it.
    const intel = readFileSync(join(SERVICES, "partner-intelligence.service.ts"), "utf8");
    expect(intel).toMatch(/LOCATION_RECENT_S\s*=/);
    expect(intel).toMatch(/LOCATION_STALE_S\s*=/);
  });
});
