/**
 * PHASE 13 — Intelligence Operations Center: metric contracts and dashboard integrity.
 *
 * ── What these tests are for ───────────────────────────────────────────────────
 *
 * A dashboard is JSON, and JSON always parses. The failures worth catching are the ones where the
 * JSON is fine and the observability is not: a panel querying a metric nothing produces, an absent
 * series rendered as a confident zero, a sensitive dimension used as a label, or a producer that
 * exists in code and was never registered so it never reaches Prometheus at all.
 *
 * The last one is not hypothetical. `registerMlPlatformHealthSamplers` was written in Phase 12 and
 * never called, so `ml_platform_serviceable` — the gauge that says the ML platform cannot answer a
 * question about now — existed in the codebase and in no time series. A producer with no collection
 * is not a metric, and nothing in the test suite noticed.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const BACKEND = join(REPO, "apps", "backend");
const DASH = join(BACKEND, "monitoring", "_obsstack", "dashboards");

const iocFiles = readdirSync(DASH).filter((f) => f.startsWith("homigo-ioc-") && f.endsWith(".json"));
const iocDashboards = iocFiles.map((f) => ({
  file: f,
  json: JSON.parse(readFileSync(join(DASH, f), "utf8")) as {
    uid: string; title: string; tags: string[]; schemaVersion: number; links?: unknown[];
    panels: Array<{
      title: string; type: string; description?: string;
      fieldConfig?: { defaults?: { noValue?: string } };
      targets?: Array<{ expr?: string; datasource?: { uid?: string }; legendFormat?: string }>;
    }>;
  },
}));

/** Every expression across every IOC dashboard, with its panel for error messages. */
const allTargets = iocDashboards.flatMap((d) =>
  d.json.panels.flatMap((p) =>
    (p.targets ?? []).filter((t) => t.expr).map((t) => ({ dash: d.json.title, panel: p.title, ...t })),
  ),
);

describe("the Intelligence Operations Center extends the existing Grafana, not a second one", () => {
  test("all five boards exist and are provisioned from the live folder", () => {
    expect(iocFiles.length).toBe(5);
    const uids = iocDashboards.map((d) => d.json.uid).sort();
    expect(uids).toEqual([
      "homigo-ioc-ai", "homigo-ioc-automation", "homigo-ioc-events",
      "homigo-ioc-ml", "homigo-ioc-overview",
    ]);
  });

  test("they follow the existing dashboard conventions rather than inventing new ones", () => {
    for (const { json } of iocDashboards) {
      expect(json.schemaVersion).toBe(39);
      expect(json.tags).toContain("homigo");
      expect(json.tags).toContain("enterprise");
      // The shared tag is what makes the cross-board dropdown work.
      expect(json.tags).toContain("ioc");
    }
  });

  test("every query targets the one provisioned datasource", () => {
    for (const t of allTargets) {
      expect(t.datasource?.uid).toBe("prometheus");
    }
  });

  test("the boards link to each other instead of duplicating panels", () => {
    for (const { json } of iocDashboards) {
      expect(Array.isArray(json.links)).toBe(true);
      expect(JSON.stringify(json.links)).toContain("ioc");
    }
  });
});

describe("zero, unknown and error are never conflated", () => {
  /**
   * The absolute rule of this phase. An absent series must render as NO DATA; only a measured value
   * may render as a number. Grafana's `noValue` is what decides that, so every panel must set it
   * deliberately rather than inherit the default.
   */
  test("every data panel declares what an absent series looks like", () => {
    const missing: string[] = [];
    for (const { json } of iocDashboards) {
      for (const p of json.panels) {
        if (!["stat", "timeseries", "table"].includes(p.type)) continue;
        if (p.fieldConfig?.defaults?.noValue === undefined) missing.push(`${json.title} :: ${p.title}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * No panel may render an absent series as a number — not one.
   *
   * The unknown-cost panel used to be an allowed exception, on the reasoning that an absent counter
   * meant "no request had unknown cost". That reasoning held while the exporter was alive and broke
   * the moment it was not: with the backend down the series is equally absent, and the panel would
   * have shown "0 requests missing from the cost figure" while nothing could be measured at all —
   * the single panel on the board still claiming a number during an outage. The counter is seeded at
   * zero instead, so 0 is measured and absence stays absence.
   */
  test("no panel renders an absent series as a number", () => {
    const zeroValued: string[] = [];
    for (const { json } of iocDashboards) {
      for (const p of json.panels) {
        const nv = p.fieldConfig?.defaults?.noValue;
        if (nv !== undefined && nv !== "NO DATA") zeroValued.push(`${json.title} :: ${p.title} = ${nv}`);
      }
    }
    expect(zeroValued).toEqual([]);
  });

  test("no panel silently substitutes a default for a missing measurement", () => {
    for (const t of allTargets) {
      // `or vector(0)` and `absent()`-style defaults would turn an outage into a confident number.
      expect(t.expr).not.toMatch(/or\s+vector\s*\(/i);
      expect(t.expr).not.toMatch(/\bor\s+on\s*\(/i);
    }
  });
});

describe("labels stay bounded and carry nothing sensitive", () => {
  /**
   * The property is about label *keys*, not about words appearing anywhere. `homigo_ai_prompt_blocked`
   * is the safe design — it counts blocks by category and never carries the prompt — so a check that
   * matched the substring "prompt" would fail on exactly the metric it should approve.
   */
  const FORBIDDEN = new Set([
    "customer_id", "user_id", "booking_id", "ticket_id", "email", "phone",
    "prompt", "api_key", "token", "arguments", "argument", "payload", "content",
  ]);

  function labelsOf(expr: string): string[] {
    const out: string[] = [];
    for (const sel of expr.match(/\{[^}]*\}/g) ?? []) {
      for (const m of sel.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*[=!~]/g)) out.push(m[1]!);
    }
    for (const m of expr.matchAll(/\b(?:by|without)\s*\(([^)]*)\)/g)) {
      out.push(...m[1]!.split(",").map((s) => s.trim()).filter(Boolean));
    }
    return out.filter((l) => l !== "le");
  }

  test("no query selects or groups by a sensitive dimension", () => {
    const leaks: string[] = [];
    for (const t of allTargets) {
      for (const l of labelsOf(t.expr!)) {
        if (FORBIDDEN.has(l)) leaks.push(`${t.dash} :: ${t.panel} :: ${l}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test("grouping dimensions are drawn from bounded sets", () => {
    const ALLOWED = new Set([
      "consumer", "event_type", "domain", "status", "mode", "provider", "role",
      "endpoint", "reason", "category", "direction", "model", "check", "from", "to", "job",
    ]);
    const unexpected: string[] = [];
    for (const t of allTargets) {
      for (const l of labelsOf(t.expr!)) {
        if (!ALLOWED.has(l)) unexpected.push(`${t.dash} :: ${t.panel} :: ${l}`);
      }
    }
    expect(unexpected).toEqual([]);
  });
});

describe("every metric a panel queries has a producer in this codebase", () => {
  /**
   * The check the Phase-12 miss would have failed.
   *
   * A dashboard may only query a metric something actually emits. Scanning the source for the
   * literal metric name is crude but catches the two failures that matter: a typo in a panel, and a
   * panel written against a metric that was planned and never built.
   */
  const SOURCE = ["src", "analytics"]
    .flatMap((dir) => walk(join(BACKEND, dir)))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }

  /** Metric names referenced by any IOC panel, with histogram/counter suffixes stripped. */
  const referenced = new Set<string>();
  for (const t of allTargets) {
    for (const m of t.expr!.matchAll(/\b([a-z_][a-z0-9_]*_?[a-z0-9_]*)\s*(?:\{|\[|\)|\s|$)/g)) {
      const n = m[1]!;
      if (n.startsWith("homigo_") || n.startsWith("ml_") || n.startsWith("model_")) referenced.add(n);
    }
  }

  test("the panels reference a meaningful number of metrics", () => {
    expect(referenced.size).toBeGreaterThan(15);
  });

  test("each referenced metric is emitted somewhere in the backend", () => {
    const orphans: string[] = [];
    for (const name of referenced) {
      // Histogram queries reference the _bucket/_sum/_count series; the producer names the base.
      const base = name.replace(/_(bucket|sum|count)$/, "");
      if (!SOURCE.includes(`"${base}"`) && !SOURCE.includes(`"${name}"`)) orphans.push(name);
    }
    expect(orphans).toEqual([]);
  });
});

describe("the producers that were missing are now registered", () => {
  const index = readFileSync(join(BACKEND, "src", "index.ts"), "utf8");

  /**
   * Phase 12 wrote this sampler and never called it, so the ML platform health gauges reached no
   * time series at all. Registration is asserted here because "the function exists" was exactly the
   * evidence that misled the previous audit.
   */
  test("ML platform health samplers are registered at boot", () => {
    expect(index).toContain("registerMlPlatformHealthSamplers");
  });

  test("automation inventory samplers are registered at boot", () => {
    expect(index).toContain("initAutomationMetricsAtZero");
    expect(index).toContain("registerAutomationMetricSamplers");
  });

  test("automation seeds a closed label space so 'nothing ran' differs from 'not instrumented'", () => {
    const src = readFileSync(join(BACKEND, "src", "lib", "automation-metrics.ts"), "utf8");
    expect(src).toContain("initAutomationMetricsAtZero");
    // Definition states and instance states come from the schema's enums, not from free text.
    for (const s of ["DRAFT", "ACTIVE", "DISABLED", "ARCHIVED"]) expect(src).toContain(s);
    for (const s of ["LIVE", "SHADOW"]) expect(src).toContain(s);
    expect(src).toContain("WAITING");
  });

  test("a sampler failure leaves the last value rather than publishing zeros", () => {
    const src = readFileSync(join(BACKEND, "src", "lib", "automation-metrics.ts"), "utf8");
    // The catch block must not setGauge — an infrastructure failure is not "there are no workflows".
    const catchBlock = src.slice(src.indexOf("} catch {"));
    expect(catchBlock).not.toContain("setGauge");
  });
});

describe("AI cost never reports unknown as free", () => {
  test("an unpriced request is counted, not observed as zero cost", () => {
    const src = readFileSync(join(BACKEND, "src", "lib", "ai-metrics.ts"), "utf8");
    expect(src).toContain("homigo_ai_cost_unknown_total");
    expect(src).toMatch(/costStatus === "UNKNOWN"/);
    // The unknown branch must return before touching the cost histogram.
    const fn = src.slice(src.indexOf("export function recordAiCost"));
    const unknownIdx = fn.indexOf('costStatus === "UNKNOWN"');
    const histIdx = fn.indexOf('observeHist("homigo_ai_cost"');
    expect(unknownIdx).toBeGreaterThan(-1);
    expect(unknownIdx).toBeLessThan(histIdx);
  });

  test("the gateway passes the cost status through instead of dropping it", () => {
    const src = readFileSync(join(BACKEND, "src", "ai", "gateway", "ai-gateway.ts"), "utf8");
    expect(src).toMatch(/recordAiCost\(costUsd, routed\.provider, actor\.actorRole, costStatus\)/);
  });
});

describe("no metric fabricates an observation", () => {
  /**
   * The forensic pass found nine of these.
   *
   * Seeding a counter at zero states a true fact — "this has happened zero times". Seeding a
   * histogram by observing 0 fabricates a measurement: `_count` increments, a sample lands in the
   * lowest bucket, and percentiles are dragged toward zero for as long as the seed sits inside the
   * rate window after a restart. Measured on a fresh process with no AI traffic:
   * `homigo_ai_latency_count{provider="GROQ"} 1` with `le="0.005"` also 1 — one sub-5ms provider
   * call that never happened.
   *
   * A latency panel reading ~0ms before any request has been made is worse than one reading NO DATA,
   * because only one of them is true.
   */
  const METRIC_MODULES = [
    "lib/ai-metrics.ts",
    "lib/ai-brain-metrics.ts",
    "lib/ai-tools-metrics.ts",
    "lib/eta-metrics.ts",
    "lib/etl-metrics.ts",
    "lib/automation-metrics.ts",
  ];

  test("no module seeds a histogram with a zero observation", () => {
    const offenders: string[] = [];
    for (const m of METRIC_MODULES) {
      const src = readFileSync(join(BACKEND, "src", m), "utf8");
      for (const line of src.split("\n")) {
        if (/observeHist\(\s*"[a-z_]+"\s*,\s*0\s*[,)]/.test(line)) offenders.push(`${m}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("counters are still seeded, so a measured zero remains distinguishable from absence", () => {
    const src = readFileSync(join(BACKEND, "src", "lib", "ai-metrics.ts"), "utf8");
    // Zero-seeded counters are the legitimate half of the pattern and must not have been removed.
    expect(src).toMatch(/incCounter\("homigo_ai_requests_total".*, 0\)/);
    expect(src).toMatch(/incCounter\("homigo_ai_success_total".*, 0\)/);
    expect(src).toContain("Histograms are deliberately NOT seeded");
  });

  test("the automation sampler seeds gauges, which state a fact rather than observing one", () => {
    const src = readFileSync(join(BACKEND, "src", "lib", "automation-metrics.ts"), "utf8");
    expect(src).toContain("setGauge");
    expect(src).not.toMatch(/observeHist\(\s*"[a-z_]+"\s*,\s*0\s*[,)]/);
  });
});

describe("telemetry freshness is measured from data, not from the scrape attempt", () => {
  /**
   * `timestamp(up{...})` is the age of Prometheus's own scrape *attempt*, and Prometheus keeps
   * attempting — recording up=0 — every 10s after an exporter dies. A freshness panel built on it
   * read 4.9 seconds while every real series had already been stale-marked and removed, which is a
   * freshness indicator that stays green through an outage.
   */
  test("the data-age panel anchors on a real exporter series", () => {
    const overview = JSON.parse(
      readFileSync(join(DASH, "homigo-ioc-overview.json"), "utf8"),
    ) as { panels: Array<{ title: string; targets?: Array<{ expr?: string }> }> };

    const age = overview.panels.find((p) => p.title === "Telemetry data age");
    expect(age).toBeDefined();
    const expr = age!.targets?.[0]?.expr ?? "";
    expect(expr).toContain("timestamp(");
    // Must not be built on `up`, which survives the outage it is supposed to reveal.
    expect(expr).not.toContain("up{");
    expect(expr).toContain("homigo_");
  });

  test("scrape liveness is still shown separately", () => {
    const overview = JSON.parse(readFileSync(join(DASH, "homigo-ioc-overview.json"), "utf8")) as {
      panels: Array<{ title: string; targets?: Array<{ expr?: string }> }>;
    };
    const target = overview.panels.find((p) => p.title === "Backend scrape target");
    expect(target?.targets?.[0]?.expr).toContain('up{job="homigo-backend"}');
  });
});
