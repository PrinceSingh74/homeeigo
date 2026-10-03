/**
 * The two recurring runtime warnings, and the controls that make them safe to see.
 *
 *   ml_platform_not_serviceable   the ETL has not succeeded since BigQuery billing was disabled
 *   presence_sweep expired=1 …    one demo partner's app has been offline for hours
 *
 * Neither was suppressed. Both were traced, and what this file pins is the thing that makes each
 * one merely informative rather than dangerous:
 *
 *   * no ML model may serve a product path while the platform is unserviceable;
 *   * matching may never treat a stale or expired provider as present.
 *
 * If either of those stops being true, the warning stops being noise and becomes an incident — so
 * the controls are tested, not the log lines.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

describe("ml_platform_not_serviceable — correct, and harmless because nothing serves", () => {
  test("the models that exist declare themselves NOT_SERVING", () => {
    // Traced 2026-09-23: the ETL check fails honestly (last success is far past the freshness
    // bound). It is harmless ONLY because no model output reaches a customer or a partner.
    for (const rel of [
      "src/services/cancellation-risk.service.ts",
      "src/services/provider-acceptance.service.ts",
    ]) {
      expect(read(rel).includes("NOT_SERVING"), `${rel} no longer declares itself offline`).toBe(true);
    }
  });

  test("the one classifier that IS used has a deterministic fallback", () => {
    const support = read("src/services/support-classification.service.ts");
    expect(support).toContain("deterministic fallback");
    // A support screen must always have something to show, model or no model.
    expect(support).toContain("OUTPUT_INVALID");
  });

  test("the warning is throttled to transitions, and the GAUGES are not", () => {
    const health = read("src/services/ml-platform-health.service.ts");
    // Gauges on every sample — that is the channel an alert watches.
    expect(health).toContain('setGauge("ml_platform_serviceable"');
    expect(health).toContain('setGauge("ml_platform_check_state"');
    // The log marks changes rather than repeating on every scrape, and says which kind it is.
    expect(health).toContain("noteServiceability(");
    expect(health).toContain('transition: changed ? "changed" : "ongoing"');
    // Recovery is logged too — otherwise the logs only ever show the bad state.
    expect(health).toContain('logger.info("ml_platform_serviceable"');
  });

  test("the health check still fails loudly rather than being downgraded", () => {
    const health = read("src/services/ml-platform-health.service.ts");
    // The fix was to the LOGGING cadence. The verdict itself must still be FAIL, not WARN.
    expect(health).toContain('const failed = checks.filter((c) => c.state === "FAIL")');
    expect(health).toContain("const serviceable = failed.length === 0;");
  });
});

describe("presence_sweep — a stale partner is never dispatchable", () => {
  test("matching filters on the presence gate, not merely on availability", () => {
    const matching = read("src/services/matching.service.ts");
    // `availability` is the partner's own switch; presence is whether we have heard from them.
    // Trusting the switch alone would dispatch to a phone that died hours ago.
    expect(matching).toContain("passesPresenceLocationGate(evidence, now)");
    expect((matching.match(/passesPresenceLocationGate\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the sweep reports its thresholds, so the number can be read without the source", () => {
    const monitor = read("src/services/partner-presence-monitor.service.ts");
    expect(monitor).toContain("staleThresholdSec: PRESENCE_STALE_SEC");
    expect(monitor).toContain("locationStaleThresholdSec: LOCATION_STALE_SEC");
    // Counted as gauges as well as logged.
    expect(monitor).toContain('setGauge("partner_location_stale_total"');
  });

  test("nothing in the sweep writes a heartbeat — it observes, it does not invent", () => {
    const monitor = read("src/services/partner-presence-monitor.service.ts");
    // Freshening a heartbeat to quieten the sweep would make every downstream presence decision a
    // lie. The sweep may only read and emit.
    expect(/lastHeartbeatAt:\s*(new Date|now)/.test(monitor)).toBe(false);
    expect(/lastLocationAt:\s*(new Date|now)/.test(monitor)).toBe(false);
  });
});
