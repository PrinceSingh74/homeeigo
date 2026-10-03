/**
 * PARTNER INTELLIGENCE — D1 regression.
 *
 * `getForecast` presented two invented numbers to partners as "Weekly/Monthly Projection":
 *
 *     weeklyProjection  = weekEarnings  * 1.05
 *     monthlyProjection = monthEarnings * 1.08
 *
 * Investigated before changing anything: no comment, no document, no model and no separate
 * reasoning commit exists for either factor — both arrived inside one bulk staging-RC commit
 * (b859fd1). They were also applied to the wrong kind of number: `myDashboard` derives `thisWeek`
 * from `daysAgo(6)` and `thisMonth` from `daysAgo(29)`, so both are COMPLETE trailing windows, not
 * week-to-date. Multiplying a finished trailing total by 1.05 asserts 5% growth from nothing.
 *
 * Both figures are rendered to partners on mobile (`hq-work-earnings.tsx`) and web
 * (`earnings-hq/forecast`), so this was partner-facing fabrication, not an internal artefact.
 *
 * These assertions are source-level and deterministic: they touch no database and move no money.
 */
import { describe, test, expect, beforeAll } from "bun:test";

let code = "";

beforeAll(async () => {
  code = (await Bun.file(`${import.meta.dir}/../services/partner-os.service.ts`).text())
    // Assertions are about CODE — the fix's own comment quotes the factors it removed.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ");
});

describe("PI D1 — no invented growth factor survives", () => {
  test("the 1.05 / 1.08 multipliers are gone from the code", () => {
    expect(code).not.toContain("weekEarnings * 1.05");
    expect(code).not.toContain("monthEarnings * 1.08");
  });

  test("single-day extrapolation fallbacks are gone too", () => {
    // `todayProjection * 7` / `* 30` was the same fabrication in another form.
    expect(code).not.toContain("todayProjection * 7");
    expect(code).not.toContain("todayProjection * 30");
  });

  test("weekly and monthly are trailing actuals, not projections", () => {
    expect(code).toContain("const weeklyProjection = Math.round(weekEarnings);");
    expect(code).toContain("const monthlyProjection = Math.round(monthEarnings);");
  });
});

describe("PI D1 — every figure declares what it is", () => {
  test("a basis block accompanies the numbers", () => {
    expect(code).toContain("basis:");
    expect(code).toContain("TRAILING_7D_ACTUALS");
    expect(code).toContain("TRAILING_30D_ACTUALS");
  });

  test("non-predictive figures say so, and declare no growth assumption", () => {
    // Exactly two figures in this file carry a growth-assumption declaration — weekly and monthly.
    // (`predictive: false` is deliberately NOT counted file-wide: getPerformanceSummary legitimately
    // declares itself non-predictive too, and a file-wide count would break every time an honest
    // basis block is added.)
    expect(code.match(/growthAssumptionApplied: false/g)?.length).toBe(2);
    expect(code).toContain('method: "TRAILING_7D_ACTUALS", predictive: false');
    expect(code).toContain('method: "TRAILING_30D_ACTUALS", predictive: false');
  });

  test("the one forward-looking figure carries the demand model's own confidence and source", () => {
    // todayProjection is genuinely predictive: it prices the demand model's output at the
    // partner's real average per job, so it must not claim more certainty than that model has.
    expect(code).toContain("predictive: true");
    expect(code).toContain("confidence: demand.confidence ?? null");
    expect(code).toContain('source: demand.source ?? "bigquery:arima_plus"');
  });

  test("absent history is an explicit state, never a fabricated number", () => {
    expect(code.match(/INSUFFICIENT_HISTORY/g)?.length).toBe(2);
  });
});

describe("PI D2 — the performance tool reports performance", () => {
  /**
   * `read.partner.getPartnerPerformance` was bound to `getProviderIntelligence`, which returns
   * repeat-customer stats. A partner asking the copilot "how is my performance?" would have been
   * answered with retention numbers presented as performance — a confident, wrong answer, which is
   * exactly the failure mode an LLM must never be set up for.
   */
  let handlers = "";
  let service = "";

  beforeAll(async () => {
    const strip = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ");
    handlers = strip(await Bun.file(`${import.meta.dir}/../ai-tools/execution/handlers/index.ts`).text());
    service = strip(await Bun.file(`${import.meta.dir}/../services/partner-os.service.ts`).text());
  });

  test("the tool is bound to a method that matches its name", () => {
    expect(handlers).toContain("partnerOsService.getPerformanceSummary(providerId, Number(args.days ?? 90))");
    expect(handlers).not.toContain("getPartnerPerformance\": async ({ actor, arguments: args }) => { const providerId = await resolveProviderId(actor.actorId); if (!providerId) throw new Error(\"PROVIDER_NOT_FOUND\"); return partnerOsService.getProviderIntelligence");
  });

  test("performance reports real rate counters, not retention", () => {
    for (const field of ["completionRate", "acceptanceRate", "cancellationRate", "responseRate"]) {
      expect(service).toContain(field);
    }
  });

  test("retention is still returned, under its own key", () => {
    // Kept, but where it cannot impersonate a performance metric.
    expect(service).toContain("retention,");
  });

  test("sample size travels with the metrics so callers can gate trend language", () => {
    expect(service).toContain("sampleSize: completedInWindow");
  });
});
