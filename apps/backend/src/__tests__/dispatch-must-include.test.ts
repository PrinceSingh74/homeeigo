/**
 * W2-D2 — the dispatch pin is a soft preference, dev/test only, and bypasses nothing.
 *
 * REWRITTEN, not relaxed. The previous version of this file asserted the defect as intended
 * behaviour: that a hardcoded personal e-mail mapped to a personal phone on every host, that a pinned
 * partner could skip OFFLINE / OUTSIDE_SERVICE_AREA / STALE_PRESENCE, and that a pinned partner's
 * missing GPS was replaced with the job address at arrive/start. Each of those assertions is now its
 * opposite, because the owner's policy (Wave 2, D2) is the opposite.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_DISPATCH_MUST_INCLUDE,
  canonicalDispatchEmail,
  mustIncludePhonesForEmail,
  parseDispatchMustInclude,
  preferPinnedAmongEligible,
} from "../lib/dispatch-must-include";
import * as pinModule from "../lib/dispatch-must-include";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

describe("no personal data, no default", () => {
  test("the default mapping is empty", () => {
    expect(Object.keys(DEFAULT_DISPATCH_MUST_INCLUDE)).toEqual([]);
  });

  test("no personal e-mail or phone survives anywhere in the pin code path", () => {
    for (const rel of [
      "src/lib/dispatch-must-include.ts",
      "src/services/dispatch-must-include.service.ts",
      "src/services/assignment-engine.service.ts",
      "src/services/booking.service.ts",
    ]) {
      const source = read(rel);
      expect(source.includes("princesingh"), `${rel} still carries a personal e-mail`).toBe(false);
      expect(source.includes("9876543211"), `${rel} still carries a personal phone`).toBe(false);
    }
  });

  test("an absent variable means no preference — never someone's hardcoded one", () => {
    const pins = parseDispatchMustInclude(undefined, { allowed: true });
    expect(pins.size).toBe(0);
  });

  test("the typo-correction that existed only to match the hardcoded pin is gone", () => {
    // `gamil.com` was rewritten to `gmail.com` so a typo'd personal address still matched.
    expect(canonicalDispatchEmail("Someone@Gamil.com")).toBe("someone@gamil.com");
  });
});

describe("never on a deployed host", () => {
  const RAW = '{"customer@example.test":["9800000000"]}';

  test("a deployed host resolves every pin to nothing, even with the variable set", () => {
    const pins = parseDispatchMustInclude(RAW, { allowed: false });
    expect(pins.size).toBe(0);
    expect(mustIncludePhonesForEmail("customer@example.test", pins)).toEqual([]);
  });

  test("a dev/test host honours an explicit mapping", () => {
    const pins = parseDispatchMustInclude(RAW, { allowed: true });
    expect(mustIncludePhonesForEmail("customer@example.test", pins)).toEqual(["+919800000000"]);
  });

  test("the gate is the canonical deployed-environment check, not NODE_ENV", () => {
    // `.env.staging` ships NODE_ENV=development with APP_ENV=staging. A NODE_ENV check would have
    // enabled pins on staging.
    expect(read("src/lib/dispatch-must-include.ts")).toContain("devAffordancesAllowed()");
  });

  test("malformed configuration is no preference, not an error and not a fallback", () => {
    for (const bad of ["not json", "[]", "null", '{"x": "not-an-array"}', ""]) {
      expect(parseDispatchMustInclude(bad, { allowed: true }).size).toBe(0);
    }
  });
});

describe("a pin reorders the eligible — it can never add the ineligible", () => {
  const ranked = [{ providerId: "near-1" }, { providerId: "pinned" }, { providerId: "near-2" }];

  test("a pinned partner that passed matching moves to the front", () => {
    const out = preferPinnedAmongEligible(ranked, new Set(["pinned"]));
    expect(out.map((p) => p.providerId)).toEqual(["pinned", "near-1", "near-2"]);
  });

  test("a pinned partner that FAILED matching is not offered at all", () => {
    // The central property. Absent from `ranked` means it failed a hard gate: offline, stale, out
    // of area, at capacity, double-booked, or missing the skill. It must stay absent.
    const out = preferPinnedAmongEligible(ranked, new Set(["offline-and-pinned"]));
    expect(out.map((p) => p.providerId)).toEqual(["near-1", "pinned", "near-2"]);
    expect(out.some((p) => p.providerId === "offline-and-pinned")).toBe(false);
  });

  test("the output is never longer than the eligible input", () => {
    const out = preferPinnedAmongEligible(ranked, new Set(["a", "b", "c", "pinned"]));
    expect(out.length).toBe(ranked.length);
  });

  test("no pin means the ranking is untouched", () => {
    expect(preferPinnedAmongEligible(ranked, new Set())).toEqual(ranked);
  });

  test("order within each group is preserved, so dispatch stays deterministic", () => {
    const many = [{ providerId: "a" }, { providerId: "p1" }, { providerId: "b" }, { providerId: "p2" }];
    const out = preferPinnedAmongEligible(many, new Set(["p2", "p1"]));
    expect(out.map((p) => p.providerId)).toEqual(["p1", "p2", "a", "b"]);
  });
});

describe("the bypass machinery no longer exists", () => {
  test("no bypass API is exported", () => {
    const exported = Object.keys(pinModule);
    for (const gone of ["canBypassMustIncludeBlock", "MUST_INCLUDE_BYPASS_BLOCKS", "applyMustIncludeProximityBypass", "mergeMustIncludeFront"]) {
      expect(exported.includes(gone), `${gone} is still exported`).toBe(false);
    }
  });

  test("no 10,000-score partner is synthesised in the assignment engine", () => {
    const engine = read("src/services/assignment-engine.service.ts");
    expect(engine.includes("mustIncludeMatch")).toBe(false);
    expect(engine.includes("10_000")).toBe(false);
  });

  test("a pin no longer forces broadcast mode", () => {
    expect(read("src/services/assignment-engine.service.ts")).toContain("const broadcast = BROADCAST_DISPATCH;");
  });

  test("offer-time: a blocked partner is always skipped", () => {
    const engine = read("src/services/assignment-engine.service.ts");
    expect(engine.includes("pinnedOffer")).toBe(false);
    expect(engine.includes("dispatch_must_include_offer_bypass")).toBe(false);
  });

  test("accept: no pin bypass and — above all — no fabricated presence", () => {
    const booking = read("src/services/booking.service.ts");
    // It used to write lastHeartbeatAt/lastLocationAt = now for a stale pinned partner.
    expect(booking.includes("partnerPresence.updateMany")).toBe(false);
    expect(booking.includes("resolveMustIncludeProviderIds")).toBe(false);
  });

  test("arrive / start: no GPS substitution", () => {
    const booking = read("src/services/booking.service.ts");
    expect(booking.includes("applyMustIncludeProximityBypass")).toBe(false);
    expect(booking.includes("isMustIncludePinnedProvider")).toBe(false);
    // Arrival is recorded at the position the server held for the partner (2026-10-07) — never the
    // job address, and no longer the request's own coordinates either.
    expect(booking).toContain("const arriveLat = held.waived ? null : held.position.latitude;");
    expect(booking.includes("const arriveLat = booking.address")).toBe(false);
    expect(booking).toContain("if (!proximity.ok) throw new Error(proximity.error);");
  });
});
