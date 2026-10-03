/**
 * X-90 — the data-quality engine under outage shapes that the real egress barrier cannot produce:
 * a HUNG warehouse (bounded, and the remaining rules are not queried one deadline at a time), a
 * single rule's query defect (still a failure — that is a pipeline defect), and a partial outage.
 * `__setBqQueryForTests` replaces only `bqQuery`; nothing leaves the machine.
 */
import "../load-env";
import { afterEach, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import { runDataQualityChecks, DATA_QUALITY_RULES } from "../../analytics/data-quality/engine";
import { __setBqQueryForTests } from "../../analytics/etl/bq-client";

const apiError = (code: number, reason: string) => Object.assign(new Error(reason), { code, errors: [{ reason }] });
const created: string[] = [];

afterEach(async () => {
  __setBqQueryForTests(null);
  if (created.length) {
    await prisma.dataQualityResult.deleteMany({ where: { executionId: { in: created.splice(0) } } });
  }
});

describe("X-90 data quality under outage shapes", () => {
  test("a hung warehouse: bounded by one deadline, one query attempted, nothing scored or persisted", async () => {
    let calls = 0;
    __setBqQueryForTests(() => { calls++; return new Promise(() => {}); });
    const exec = `x90-hang-${Date.now()}`;
    created.push(exec);
    const t0 = Date.now();
    const report = await runDataQualityChecks(exec, { deadlineMs: 60 });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(calls).toBe(1);
    expect(report.overallScore).toBeNull();
    expect(report.sourceUnavailable).toBe(true);
    expect(report.unevaluatedRules).toBe(DATA_QUALITY_RULES.length);
    expect(await prisma.dataQualityResult.count({ where: { executionId: exec } })).toBe(0);
  });

  test("one rule's query defect (404) still FAILS that rule; the others are evaluated and scored", async () => {
    const broken = DATA_QUALITY_RULES[0]!.sql;
    __setBqQueryForTests(async (sql) => {
      if (sql === broken) throw apiError(404, "notFound");
      return [{ cnt: 0 }];
    });
    const exec = `x90-404-${Date.now()}`;
    created.push(exec);
    const report = await runDataQualityChecks(exec);
    const first = report.rules[0]!;
    expect(first.evaluated).toBe(true);
    expect(first.passed).toBe(false);
    expect(report.rules.slice(1).every((r) => r.evaluated && r.passed)).toBe(true);
    expect(report.overallScore).not.toBeNull();
    expect(report.overallScore!).toBeLessThan(100);
    expect(report.sourceUnavailable).toBe(false);
    expect(await prisma.dataQualityResult.count({ where: { executionId: exec } })).toBe(DATA_QUALITY_RULES.length);
  });

  test("a partial outage (one dataset's 403): that rule is unevaluated, the rest are scored over what was measured", async () => {
    const denied = DATA_QUALITY_RULES[1]!.sql;
    __setBqQueryForTests(async (sql) => {
      if (sql === denied) throw apiError(403, "accessDenied");
      return [{ cnt: 0 }];
    });
    const exec = `x90-403-${Date.now()}`;
    created.push(exec);
    const report = await runDataQualityChecks(exec);
    expect(report.unevaluatedRules).toBe(1);
    expect(report.rules[1]!.evaluated).toBe(false);
    expect(report.overallScore).toBe(100);
    expect(report.sourceUnavailable).toBe(false);
    expect(await prisma.dataQualityResult.count({ where: { executionId: exec } })).toBe(DATA_QUALITY_RULES.length - 1);
  });
});
