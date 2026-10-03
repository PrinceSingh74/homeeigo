import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CITY_SEEDS,
  deriveCitySummary,
  deriveCityDetail,
  deriveResponseEngine,
} from "../data/hyperlocal-coverage";
import {
  CANCELLED_BOOKING_STATUSES,
  cancellationRatePct,
  completionRatePct,
} from "../lib/fulfillment-rates";

/**
 * 6C — the customer-facing city coverage brief must be measured or absent.
 *
 * ── What was published ──────────────────────────────────────────────────────
 *
 * Every operational figure on this page came from `seeded()` — deterministic hashing of the city
 * slug, with no connection to any booking, partner or dispatch that ever happened:
 *
 *     Service Fulfillment   seeded(98.2, 99.6)
 *     Booking Acceptance    seeded(91, 98)      (fixed in 6B)
 *     Completion Rate       seeded(96.5, 99.4)
 *     Cancellation Rate     seeded(0.6, 2.8)
 *     Avg Arrival Time      seededInt(24, 34|44)
 *
 * The three headline counts were worse than seeded — they LOOKED live. `activePartners`,
 * `customers` and `servicesCompleted` read `live?.x && live.x > 0 ? live.x : baseline`, so a real
 * measurement of ZERO fell through to the seeded baseline. Measured against the database, Delhi had
 * 0 partners and 0 completed bookings while the page published 250 verified partners, 30,267
 * customers and 70,389 services completed. Platform-wide, 18 of 590 providers have a city set, so
 * ten of the eleven cities were publishing invented operating history.
 *
 * These cases pin the repaired contract: a measured zero is a measurement, and anything that cannot
 * be measured is absent rather than invented.
 */
const CITY = CITY_SEEDS[0]!;

describe("a measured zero is a measurement", () => {
  test("zero partners, customers and completions are published as zero, not as a baseline", () => {
    const summary = deriveCitySummary(CITY, {
      activePartners: 0,
      customers: 0,
      servicesCompleted: 0,
    });

    expect(summary.activePartners).toBe(0);
    expect(summary.customers).toBe(0);
    expect(summary.servicesCompleted).toBe(0);
  });

  test("real non-zero aggregates are carried through unchanged", () => {
    const summary = deriveCitySummary(CITY, {
      activePartners: 18,
      customers: 240,
      servicesCompleted: 434,
    });

    expect(summary.activePartners).toBe(18);
    expect(summary.customers).toBe(240);
    expect(summary.servicesCompleted).toBe(434);
  });

  test("an absent aggregate is null, a measured zero is zero — and they are different", () => {
    /**
     * `undefined` means the aggregate was never computed; `0` means it was computed and is zero.
     * They used to collapse into the same seeded baseline, which is how a city with no partners
     * advertised 250 of them. There is no baseline left to fall back to, so the distinction survives
     * all the way to the page.
     */
    const measuredZero = deriveCitySummary(CITY, { activePartners: 0 });
    const notMeasured = deriveCitySummary(CITY, {});

    expect(measuredZero.activePartners).toBe(0);
    expect(notMeasured.activePartners).toBeNull();
  });

  test("no per-area or per-society number is published — none can be measured", () => {
    // Providers carry a `city` and nothing finer, so an area partner count, an area density band, a
    // society response time and a society star rating had no source and were all seeded hashes.
    const detail = deriveCityDetail(CITY, { live: {} });

    for (const area of detail.areas) {
      expect(area.activePartners).toBeNull();
      expect(area.density).toBeNull();
      expect(area.avgArrivalMins).toBeNull();
      // Geography and declared availability are real editorial data and must survive.
      expect(area.name.length).toBeGreaterThan(0);
      expect(["AVAILABLE", "LIMITED", "COMING_SOON"]).toContain(area.status);
    }
    for (const society of detail.societies) {
      expect(society.partnerCount).toBeNull();
      expect(society.avgResponseMins).toBeNull();
      expect(society.rating).toBeNull();
    }
    for (const pincode of detail.pincodes) expect(pincode.partnerCount).toBeNull();
  });

  test("the coverage score is built from declared availability alone", () => {
    /**
     * Forty percent of this score came from a seeded partner count, and it is rendered as a
     * percentage. What remains is the share of the city declared AVAILABLE or LIMITED — the one
     * thing this module genuinely knows.
     */
    const score = deriveCitySummary(CITY, {}).coverageScore;
    const areas = CITY.areas;
    const available = areas.filter((a) => a.status === "AVAILABLE").length;
    const limited = areas.filter((a) => a.status === "LIMITED").length;
    expect(score).toBe(Math.round(((available + limited * 0.5) / areas.length) * 100));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("unmeasurable operational figures are absent, never invented", () => {
  test("with no live evidence every response-engine figure is null", () => {
    const engine = deriveResponseEngine(CITY, {});

    expect(engine.acceptanceRate).toBeNull();
    expect(engine.completionRate).toBeNull();
    expect(engine.cancellationRate).toBeNull();
    expect(engine.avgArrivalMins).toBeNull();
  });

  test("the same city returns the same nulls on every call — no seeded value can leak back", () => {
    /**
     * The old figures were deterministic per slug, so they looked stable and trustworthy. Stability
     * is not evidence: this asserts the values are absent, not merely consistent.
     */
    const a = deriveResponseEngine(CITY, {});
    const b = deriveResponseEngine(CITY, {});
    expect(a).toEqual(b);
    for (const value of Object.values(a)) expect(value).toBeNull();
  });

  test("measured figures are carried through exactly", () => {
    const engine = deriveResponseEngine(CITY, {
      acceptanceRate: 44.83,
      completionRate: 95.6,
      cancellationRate: 4.4,
      avgArrivalMins: 27,
    });

    expect(engine.acceptanceRate).toBe(44.83);
    expect(engine.completionRate).toBe(95.6);
    expect(engine.cancellationRate).toBe(4.4);
    expect(engine.avgArrivalMins).toBe(27);
  });

  test("Service Fulfillment is reported as unmeasured — it has no agreed definition", () => {
    // It was seeded(98.2, 99.6). It is a third label beside completion and cancellation with no
    // distinct authoritative meaning, so it is absent rather than aliased onto one of them.
    expect(deriveCitySummary(CITY, { servicesCompleted: 434 }).fulfillmentRate).toBeNull();
  });

  test("a full city detail payload contains no seeded operational metric", () => {
    const detail = deriveCityDetail(CITY, { live: {} });
    expect(detail.responseEngine).toEqual({
      avgArrivalMins: null,
      acceptanceRate: null,
      completionRate: null,
      cancellationRate: null,
    });
    expect(detail.summary.fulfillmentRate).toBeNull();
  });
});

describe("completion and cancellation share one definition", () => {
  test("no finished bookings is null — not 0%, which would claim nothing ever succeeded", () => {
    expect(completionRatePct(0, 0)).toBeNull();
    expect(cancellationRatePct(0, 0)).toBeNull();
  });

  test("the two rates are complements of the same denominator", () => {
    const completed = 95;
    const cancelled = 5;
    expect(completionRatePct(completed, cancelled)).toBe(95);
    expect(cancellationRatePct(completed, cancelled)).toBe(5);
    expect(
      (completionRatePct(completed, cancelled) ?? 0) + (cancellationRatePct(completed, cancelled) ?? 0),
    ).toBe(100);
  });

  test("real extremes are reportable — all completed is 100, all cancelled is 0", () => {
    expect(completionRatePct(10, 0)).toBe(100);
    expect(completionRatePct(0, 10)).toBe(0);
  });

  test("an impossible or non-finite sample is null rather than a plausible-looking number", () => {
    expect(completionRatePct(-1, 5)).toBeNull();
    expect(completionRatePct(Number.NaN, 5)).toBeNull();
    expect(completionRatePct(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("REJECTED is not a cancellation — it is a dispatch outcome the acceptance rate already counts", () => {
    // Folding it in here would count one provider refusal against two different metrics.
    expect(CANCELLED_BOOKING_STATUSES).toContain("CANCELLED_BY_USER");
    expect(CANCELLED_BOOKING_STATUSES).toContain("CANCELLED_BY_PROVIDER");
    expect(CANCELLED_BOOKING_STATUSES).not.toContain("REJECTED");
  });
});

describe("no seeded value can reach a published operational metric", () => {
  const source = readFileSync(join(import.meta.dir, "..", "data", "hyperlocal-coverage.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

  test("deriveResponseEngine reads only live evidence", () => {
    const fn = source.slice(source.indexOf("export function deriveResponseEngine"));
    const body = fn.slice(0, fn.indexOf("\n}"));

    // The whole point: not one seeded call inside the function that feeds the customer page.
    expect(body).not.toContain("seeded(");
    expect(body).not.toContain("seededInt(");
    for (const field of ["avgArrivalMins", "acceptanceRate", "completionRate", "cancellationRate"]) {
      expect(body).toContain(`${field}: live?.${field} ?? null`);
    }
  });

  test("the headline counts no longer discard a measured zero", () => {
    // `live.x > 0 ? live.x : baseline` is the exact shape that turned a real 0 into an invention.
    expect(source).not.toMatch(/live\?\.activePartners && live\.activePartners > 0/);
    expect(source).not.toMatch(/live\?\.customers && live\.customers > 0/);
    expect(source).not.toMatch(/live\?\.servicesCompleted && live\.servicesCompleted > 0/);
  });
});

describe("the model explains evidence, it never manufactures it", () => {
  /**
   * 6C §4 — the LLM boundary.
   *
   * Every brief, explainer and narrative surface on this platform is a DETERMINISTIC assembler over
   * an evidence object: none of them calls a model. That is the property worth protecting, because
   * it is easy to lose — wiring a gateway into an explainer to "improve the wording" would quietly
   * make a language model the source of a number an executive acts on.
   *
   * Asserted structurally rather than behaviourally: a runtime test can only show that the model was
   * not consulted on the inputs it happened to be given, whereas an import is a standing capability.
   */
  const NARRATIVE_SERVICES = [
    "digital-twin-narrative.service.ts",
    "finance-narrative.service.ts",
    "fraud-narrative.service.ts",
    "executive-kpi-explainer.service.ts",
    "partner-insight-explainer.service.ts",
    "forecast-explainer.service.ts",
    "morning-intelligence.service.ts",
    "executive-intelligence.service.ts",
    "coverage.service.ts",
  ];

  const LLM_MARKERS = ["ai-gateway", "aiGateway", "generateContent", "chat.completions", "@anthropic-ai", "openai"];

  test("no brief or explainer service can reach a language model", () => {
    for (const file of NARRATIVE_SERVICES) {
      const code = readFileSync(join(import.meta.dir, "..", "services", file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
        .join("\n");
      for (const marker of LLM_MARKERS) {
        expect(`${file}:${marker}:${code.includes(marker)}`).toBe(`${file}:${marker}:false`);
      }
    }
  });
});

describe("unknown is never coerced into a perfect score", () => {
  /**
   * 6C §5 — null semantics.
   *
   * `?? 100` on a rate or score is the most dangerous coercion in this codebase, because the value
   * it invents is the most reassuring one available. It has appeared three times: the provider
   * acceptance rate (6B) and both ETA label-quality scores, where an empty dataset reported a
   * PERFECT 100% data-quality score.
   *
   * The first version of this guard did not work. It used `require("node:fs")` inside an ESM test
   * and silently scanned nothing, so it passed while the defect was present — a control that could
   * not fire, which is worse than no control at all. It now proves it inspected the tree before
   * reporting a clean result.
   */
  const SERVICES = join(import.meta.dir, "..", "services");
  const OFFENDING = /\b\w*(?:[Rr]ate|[Ss]core|[Rr]ating|Pct)\s*(?:\?\?|\|\|)\s*100\b/g;

  function codeOf(file: string): string {
    return readFileSync(join(SERVICES, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
      .join("\n");
  }

  test("the scan actually reads the service tree", () => {
    // Positive control. Without this, an empty scan reads as a clean bill of health.
    const files = readdirSync(SERVICES).filter((f) => f.endsWith(".service.ts"));
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("eta-intelligence.service.ts");
    // And the pattern itself matches the shape it is meant to catch.
    expect("qualityScore ?? 100".match(OFFENDING)).not.toBeNull();
  });

  test("no service defaults a rate, score or rating to 100", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SERVICES).filter((f) => f.endsWith(".ts"))) {
      const matches = codeOf(file).match(OFFENDING);
      if (matches) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * ── The consumers must agree that null is possible ──────────────────────────
 *
 * 6C made four city figures `number | null`, and the backend is now correct. But each frontend
 * hand-declares its own copy of the response shape rather than importing this one, and two of those
 * copies still said `number`. `tsc --noEmit` was clean in all three apps while the admin console
 * threw `Cannot read properties of null (reading 'toFixed')` on first paint.
 *
 * A green typecheck over a type that lies about the wire is not evidence. These cases check the
 * declarations themselves, because that is the only place the drift is visible.
 */
describe("frontend copies of the coverage contract admit null", () => {
  const APPS = join(import.meta.dir, "..", "..", "..");
  const MIRRORS = [
    join(APPS, "admin-panel", "src", "services", "admin-api.ts"),
    join(APPS, "partner-web", "src", "services", "partner-api.ts"),
    join(APPS, "web", "src", "lib", "coverage", "coverage-types.ts"),
  ];
  /** The fields `deriveCitySummary` can return null for. */
  const NULLABLE = ["activePartners", "customers", "servicesCompleted", "fulfillmentRate"] as const;

  /** `field: number;` with no union — the declaration that hid the crash. */
  const bareNumber = (field: string) => new RegExp(String.raw`\b${field}\s*:\s*number\s*;`, "g");

  /**
   * Only the blocks that are copies of THIS contract, identified by carrying `fulfillmentRate`.
   *
   * Scanning whole files flagged `PartnerAcquisitionDashboard.kpis.activePartners`, an unrelated
   * figure that is correctly non-null. A guard that forces a correct declaration to change is a
   * guard people learn to route around.
   */
  const cityBlocks = (src: string): string[] =>
    (src.match(/\{[^{}]*\bfulfillmentRate\b[^{}]*\}/g) ?? []);

  test("the mirror blocks are found and the pattern can fire", () => {
    // Positive control: a renamed or moved file must fail loudly, not scan to zero and pass.
    for (const file of MIRRORS) {
      const blocks = cityBlocks(readFileSync(file, "utf8"));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) expect(block).toContain("coverageScore");
    }
    /**
     * And the pattern matches the bad shape while ignoring the good one. The first version of this
     * file was written through a shell heredoc that turned `\\b` into a literal backspace, so the
     * regex could not match anything — it passed against a deliberately regressed file.
     */
    expect("  activePartners: number;".match(bareNumber("activePartners"))).not.toBeNull();
    expect("  activePartners: number | null;".match(bareNumber("activePartners"))).toBeNull();
  });

  test("no mirror declares a nullable coverage field as a bare number", () => {
    const offenders: string[] = [];
    for (const file of MIRRORS) {
      const where = file.split(/[\\/]/).slice(-3).join("/");
      for (const block of cityBlocks(readFileSync(file, "utf8"))) {
        for (const field of NULLABLE) {
          if (block.match(bareNumber(field))) offenders.push(`${where}: ${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the summary really can return null for every one of those fields", () => {
    // Anchors the list above to the producer, so a field that stops being nullable is noticed here.
    const summary = deriveCitySummary(CITY_SEEDS[0]!) as Record<string, unknown>;
    for (const field of NULLABLE) expect(summary[field]).toBeNull();
  });
});
