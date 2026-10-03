/**
 * Pins the monitoring pipeline's *wiring*, which is where it failed — not its rules.
 *
 * On 2026-09-21, after the rule-loading defect was fixed and Prometheus reported **114 healthy
 * alert rules**, the stack still watched nothing:
 *
 *   - the only scrape target pointed at `host.docker.internal:3010`. Nothing has ever listened on
 *     3010 — the backend reads `PORT` from `.env` and runs on 3000 — so the target was `down` with
 *     "connection refused" and every rule built on a `homigo_*`/`financial_*` series evaluated
 *     against no data. 114 healthy rules, all structurally incapable of firing.
 *
 *   - `DatabaseDown` was `up{job="homigo-ready"} == 0`, reasoning that the readiness probe returns
 *     503 when the DB is unreachable. `/ready` answers **200 with application/json**, which
 *     Prometheus cannot parse, so that target was down on every scrape regardless of database
 *     state: the alert was permanently true and a database outage looked exactly like a healthy
 *     database.
 *
 * Both defects are invisible from the rules themselves, which is why they survived a pass that
 * validated the rules. These assertions look at the plumbing instead.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MONITORING = join(import.meta.dir, "..", "..", "monitoring");
const OBSSTACK = readFileSync(join(MONITORING, "_obsstack", "prometheus.yml"), "utf8");
const CANONICAL_CFG = readFileSync(join(MONITORING, "prometheus.yml"), "utf8");
const RULES = readFileSync(join(MONITORING, "rules", "homigo-alerts.yml"), "utf8");
/**
 * Rule text with `#` comments removed.
 *
 * Needed because the comments in these files quote the *old* broken expressions verbatim to explain
 * why they were wrong. Scanning the raw text would match that prose and report a defect that the
 * file exists to document — the first run of this suite did exactly that.
 */
const RULES_CODE = RULES.split("\n")
  // `\r` first: these files are CRLF, and JS `.` does not match a carriage return, so `/#.*$/`
  // against a CRLF line matches nothing at all and the strip silently no-ops.
  .map((line) => line.replace(/\r$/, "").replace(/#.*$/, ""))
  .join("\n");

/** Every canonical rule file, comment-stripped, keyed by filename. */
const ALL_RULES = Object.fromEntries(
  ["homigo-alerts.yml", "homigo-enterprise-alerts.yml", "homigo-agent-alerts.yml"].map((name) => [
    name,
    readFileSync(join(MONITORING, "rules", name), "utf8")
      .split("\n")
      .map((line) => line.replace(/\r$/, "").replace(/#.*$/, ""))
      .join("\n"),
  ]),
);
const METRICS = readFileSync(join(import.meta.dir, "..", "lib", "metrics.ts"), "utf8");
const PRISMA = readFileSync(join(import.meta.dir, "..", "lib", "prisma.ts"), "utf8");

/** The port the backend actually serves on, from the same default `src/index.ts` uses. */
const BACKEND_PORT = Number(process.env.PORT || 3000);

describe("observability — scrape wiring", () => {
  it("scrapes the port the backend actually listens on", () => {
    const targets = [...OBSSTACK.matchAll(/host\.docker\.internal:(\d+)/g)].map((m) => Number(m[1]));
    expect(targets.length).toBeGreaterThan(0);
    for (const port of targets) expect(port).toBe(BACKEND_PORT);
  });

  it("never scrapes /ready, which serves JSON and can never be parsed as metrics", () => {
    // A job pointed at it is a permanently-down target, and a target that is always down trains
    // people to ignore target-down — the one signal that would have caught the wrong port.
    expect(OBSSTACK).not.toMatch(/metrics_path:\s*\/ready/);
    expect(CANONICAL_CFG).not.toMatch(/metrics_path:\s*\/ready/);
    expect(OBSSTACK).not.toMatch(/job_name:\s*homigo-ready/);
    expect(CANONICAL_CFG).not.toMatch(/job_name:\s*homigo-ready/);
  });

  it("has no alert depending on a scrape job that does not exist", () => {
    const jobs = new Set(
      [...OBSSTACK.matchAll(/job_name:\s*(\S+)/g), ...CANONICAL_CFG.matchAll(/job_name:\s*(\S+)/g)].map((m) => m[1]!),
    );
    // Every `up{job="..."}` an alert keys on must be a job something actually scrapes.
    for (const m of RULES_CODE.matchAll(/up\{job="([^"]+)"\}/g)) {
      expect(jobs.has(m[1]!)).toBe(true);
    }
  });
});

describe("observability — database health signal", () => {
  it("publishes a dedicated database_up gauge", () => {
    expect(METRICS).toContain("database_up");
    expect(METRICS).toContain("registerDatabaseMetricsProvider");
  });

  it("registers the provider from lib/prisma with a trivial query", () => {
    expect(PRISMA).toContain("registerDatabaseMetricsProvider");
    expect(PRISMA).toMatch(/SELECT 1/);
  });

  it("reports 0 rather than omitting the series when the probe throws", () => {
    // A gauge that disappears on error makes DatabaseDown silently absent at exactly the moment it
    // is needed. Verified behaviourally too: with an unreachable DATABASE_URL the renderer emits
    // `database_up 0`, and against the live database it emits `database_up 1`.
    const block = METRICS.slice(METRICS.indexOf("databaseMetricsProvider"), METRICS.indexOf("database_up") + 200);
    expect(block).toMatch(/catch\s*\{[\s\S]{0,200}dbUp = 0/);
  });

  it("keys DatabaseDown on that gauge, not on a scrape target", () => {
    const i = RULES_CODE.indexOf("- alert: DatabaseDown");
    expect(i).toBeGreaterThan(-1);
    const block = RULES_CODE.slice(i, i + 400);
    expect(block).toContain("database_up == 0");
    expect(block).not.toContain('up{job="homigo-ready"}');
    // Guarded so a backend that is itself down raises BackendDown rather than both at once.
    expect(block).toContain('up{job="homigo-backend"} == 1');
  });
});

describe("observability — alert definitions", () => {
  it("defines each alert exactly once across the rule files", () => {
    // All three files are listed in every prometheus.yml, so a name in two files is two alerts.
    // They dedupe only if their label sets match, and the whole reason to duplicate one is that
    // someone wanted different labels — so in practice a duplicate always double-pages, and the
    // copy with the thinner labels takes the wrong route. `FinancialIntegrityBelow100` did exactly
    // that: one copy carried `priority: P0` and a runbook, the other carried neither, and a single
    // `financial_integrity_score = 92` was delivered twice in one webhook batch.
    const seen = new Map<string, string[]>();
    for (const [file, text] of Object.entries(ALL_RULES)) {
      for (const m of text.matchAll(/^\s*- alert:\s*(\S+)\s*$/gm)) {
        seen.set(m[1]!, [...(seen.get(m[1]!) ?? []), file]);
      }
    }
    const duplicated = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(duplicated).toEqual([]);
  });

  it("never clamps the denominator of a ratio it then tests with <", () => {
    // `clamp_min(denominator, 1)` avoids a divide-by-zero by replacing an unanswerable question
    // with the worst possible answer. For a `>` threshold that is harmless — 0/1 = 0 is below any
    // failure threshold. For a `<` threshold it is a permanent false alarm: an idle window scores
    // 0% and pages. `PaymentSuccessRateLow` was FIRING as a P0 on a box that had processed no
    // payments at all.
    //
    // Dividing by the true denominator gives 0/0 = NaN, and every NaN comparison is false, so an
    // idle window is silent and a real one is measured.
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(ALL_RULES)) {
      // Alert blocks start at `- alert:` and run to the next one.
      const blocks = text.split(/^\s*- alert:\s*/m).slice(1);
      for (const block of blocks) {
        const name = block.split(/\s/)[0]!;
        const expr = block.slice(0, block.search(/^\s{1,10}(for|labels|annotations):/m) + 1) || block;
        if (/\/\s*clamp_min\(/.test(expr) && /<\s*[\d.]/.test(expr)) offenders.push(`${file}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("observability — PaymentSuccessRateLow semantics", () => {
  const FINANCIAL_METRICS = readFileSync(join(import.meta.dir, "..", "lib", "financial-metrics.ts"), "utf8");

  it("seeds both payment counters at zero", () => {
    // The fix depends on this and it is not obvious from the alert.
    //
    // Removing `clamp_min` makes an idle window evaluate `0 / (0 + 0) = NaN`, and NaN comparisons
    // are false, so nothing fires. That reasoning only holds while BOTH counters exist as series.
    // If `payment_failed_total` were never initialised, `sum(increase(...))` would return no
    // samples, the division would produce no result through vector matching, and the alert would be
    // silent during a real outage — trading a false positive for a false negative, which is worse.
    //
    // Verified against the live endpoint: `payment_success_total 0` and `payment_failed_total 0`
    // are both exposed before any payment has ever been processed.
    expect(FINANCIAL_METRICS).toContain("payment_success_total");
    expect(FINANCIAL_METRICS).toContain("payment_failed_total");
  });

  it("keeps the alert strictly on the ratio, with no clamped denominator", () => {
    const enterprise = ALL_RULES["homigo-enterprise-alerts.yml"]!;
    const i = enterprise.indexOf("- alert: PaymentSuccessRateLow");
    expect(i).toBeGreaterThan(-1);
    const expr = enterprise.slice(i, i + 400);
    expect(expr).not.toContain("clamp_min");
    expect(expr).toContain("payment_failed_total");
    // Truth-tabled against the running Prometheus on 2026-09-21 by substituting vector() literals:
    //   success=0  failed=0   -> silent   (was FIRES before the fix)
    //   success=0  failed=50  -> FIRES
    //   success=90 failed=10  -> FIRES
    //   success=95 failed=5   -> silent   (threshold is strict `< 95`)
    //   success=99 failed=1   -> silent
    expect(expr).toMatch(/<\s*95/);
  });
});
