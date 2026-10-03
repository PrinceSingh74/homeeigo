/**
 * Coding-phase certification 2026-09-28: a backend started on a developer laptop against the
 * isolated homigo_test database (NODE_ENV=development) ran its scheduled ETL through the
 * developer's gcloud Application Default Credentials and reached the shared BigQuery warehouse.
 * The old rule was "anything that is not NODE_ENV=test may write".
 *
 * These cases pin the replacement policy in lib/bigquery-adc.ts:
 *   - a developer machine is refused unless egress, the exact target, and an explicit key file are
 *     all stated — an implicit gcloud login never counts;
 *   - a test runtime is refused unless HOMIGO_REQUIRE_BIGQUERY=1;
 *   - production and staging are unchanged (allowed with a well-formed target);
 *   - a malformed target (including the un-substituted deploy placeholder) is refused everywhere;
 *   - a refusal is a safe no-op: the scheduler does not start and the client is never constructed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as adc from "../lib/bigquery-adc";
import { ANALYTICS_CONFIG } from "../../analytics/config";

const TARGET = `${adc.DEFAULT_GCP_PROJECT_ID}.${adc.DEFAULT_BQ_DATASET}`;
let dir = "";
let keyFile = "";
let gcloudDir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bq-policy-"));
  keyFile = join(dir, "service-account.json");
  writeFileSync(keyFile, JSON.stringify({ type: "service_account", project_id: "homigo-497619" }));
  // What `gcloud auth application-default login` leaves behind: the file the Google client finds
  // without being told about it.
  gcloudDir = join(dir, "gcloud");
  mkdirSync(gcloudDir);
  writeFileSync(join(gcloudDir, "application_default_credentials.json"), JSON.stringify({ type: "authorized_user" }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A laptop running the backend with `.env` defaults (NODE_ENV=development, APP_ENV=dev). */
const laptop = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  APP_ENV: "dev",
  CLOUDSDK_CONFIG: gcloudDir,
  ...extra,
});
const authorizedLaptop = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  laptop({
    ANALYTICS_WAREHOUSE_EGRESS: "enabled",
    ANALYTICS_WAREHOUSE_TARGET: TARGET,
    GOOGLE_APPLICATION_CREDENTIALS: keyFile,
    ...extra,
  });

describe("local development — implicit credentials never open the warehouse", () => {
  it("a laptop with only the gcloud login is refused", () => {
    expect(adc.warehouseEgressDecision(laptop())).toEqual({ allowed: false, target: TARGET, reason: "local_egress_not_enabled" });
  });
  it("an explicit key file alone is not an authorization to write", () => {
    expect(adc.warehouseEgressDecision(laptop({ GOOGLE_APPLICATION_CREDENTIALS: keyFile }))).toMatchObject({ allowed: false, reason: "local_egress_not_enabled" });
  });
  it("an unrecognised APP_ENV (chaos, dev, preview) is treated as a laptop", () => {
    for (const appEnv of ["chaos", "dev", "preview", "Staging-2", ""]) {
      expect(adc.warehouseEgressDecision(laptop({ APP_ENV: appEnv, GOOGLE_APPLICATION_CREDENTIALS: keyFile }))).toMatchObject({ allowed: false });
    }
  });
  it("egress enabled without naming the target is refused", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop({ ANALYTICS_WAREHOUSE_TARGET: undefined }))).toMatchObject({ allowed: false, reason: "local_target_not_authorized" });
  });
});

describe("test runtime — refused unless explicitly opted in", () => {
  it("NODE_ENV=test is refused even with every local authorization present", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop({ NODE_ENV: "test" }))).toMatchObject({ allowed: false, reason: "test_runtime_without_opt_in" });
  });
  it("HOMIGO_REQUIRE_BIGQUERY=1 is the only way through", () => {
    expect(adc.warehouseEgressDecision({ NODE_ENV: "test", HOMIGO_REQUIRE_BIGQUERY: "1" })).toEqual({ allowed: true, target: TARGET, basis: "test_opt_in" });
    expect(adc.warehouseEgressDecision({ NODE_ENV: "test", HOMIGO_REQUIRE_BIGQUERY: "true" })).toMatchObject({ allowed: false });
  });
  it("this very process (bun test) is refused", () => {
    expect(adc.bigQueryAllowed()).toBe(process.env.HOMIGO_REQUIRE_BIGQUERY === "1");
  });
});

describe("authorized environments are allowed — production and staging do not regress", () => {
  it("Cloud Run production (NODE_ENV=production, no local flags, no key file) is allowed", () => {
    expect(adc.warehouseEgressDecision({ NODE_ENV: "production", GCP_PROJECT_ID: "homigo-497619" })).toEqual({
      allowed: true,
      target: "homigo-497619.homigo_analytics",
      basis: "deployed_environment",
    });
  });
  it("staging is allowed both as shipped in .env.staging and as deployed on Cloud Run", () => {
    expect(adc.warehouseEgressDecision({ NODE_ENV: "development", APP_ENV: "staging" })).toMatchObject({ allowed: true, basis: "deployed_environment" });
    expect(adc.warehouseEgressDecision({ NODE_ENV: "production", APP_ENV: "staging" })).toMatchObject({ allowed: true, basis: "deployed_environment" });
  });
  it("a laptop that states egress, the exact target and an explicit key file is allowed", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop())).toEqual({ allowed: true, target: TARGET, basis: "local_authorized" });
  });
  it("the policy resolves the same target the ETL client writes to", () => {
    expect(adc.warehouseEgressDecision(process.env).target).toBe(`${ANALYTICS_CONFIG.projectId}.${ANALYTICS_CONFIG.dataset}`);
  });
});

describe("malformed or mismatched targets are refused", () => {
  it("the un-substituted deploy placeholder GCP_PROJECT_ID=PROJECT_ID is refused even in production", () => {
    expect(adc.warehouseEgressDecision({ NODE_ENV: "production", GCP_PROJECT_ID: "PROJECT_ID" })).toMatchObject({ allowed: false, reason: "malformed_target" });
  });
  it("malformed project ids and datasets are refused", () => {
    for (const env of [
      { GCP_PROJECT_ID: "" },
      { GCP_PROJECT_ID: "ab" },
      { GCP_PROJECT_ID: "homigo-497619-" },
      { GCP_PROJECT_ID: "homigo 497619" },
      { BQ_DATASET: "homigo-analytics" },
      { BQ_DATASET: "homigo_analytics`; DROP TABLE x; --" },
      { BQ_DATASET: "" },
    ]) {
      expect(adc.warehouseEgressDecision({ NODE_ENV: "production", ...env })).toMatchObject({ allowed: false, reason: "malformed_target" });
    }
  });
  it("a laptop whose authorization names a different warehouse is refused", () => {
    for (const named of ["other-project.homigo_analytics", "homigo-497619.homigo_analytics_raw", "homigo-497619", ` ${TARGET}x`]) {
      expect(adc.warehouseEgressDecision(authorizedLaptop({ ANALYTICS_WAREHOUSE_TARGET: named }))).toMatchObject({ allowed: false, reason: "local_target_not_authorized" });
    }
  });
  it("pointing GCP_PROJECT_ID elsewhere invalidates an authorization written for the default target", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop({ GCP_PROJECT_ID: "someone-elses-proj" }))).toMatchObject({ allowed: false, reason: "local_target_not_authorized" });
  });
});

describe("missing credentials — a safe no-op", () => {
  it("egress and target stated but no key file: refused", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop({ GOOGLE_APPLICATION_CREDENTIALS: undefined }))).toMatchObject({ allowed: false, reason: "local_credentials_not_explicit" });
    expect(adc.warehouseEgressDecision(authorizedLaptop({ GOOGLE_APPLICATION_CREDENTIALS: "  " }))).toMatchObject({ allowed: false, reason: "local_credentials_not_explicit" });
  });
  it("a key file path that does not exist: refused", () => {
    expect(adc.warehouseEgressDecision(authorizedLaptop({ GOOGLE_APPLICATION_CREDENTIALS: join(dir, "missing.json") }))).toMatchObject({ allowed: false, reason: "local_credentials_not_explicit" });
  });
});

/**
 * The same decisions through the real entry points, with this process's env set to a laptop's.
 * NODE_ENV is swapped only for the synchronous span of each call and restored in `finally`.
 */
describe("the real entry points honour the policy on a laptop", () => {
  const KEYS = ["NODE_ENV", "APP_ENV", "CLOUDSDK_CONFIG", "GOOGLE_APPLICATION_CREDENTIALS", "ANALYTICS_WAREHOUSE_EGRESS", "ANALYTICS_WAREHOUSE_TARGET", "HOMIGO_REQUIRE_BIGQUERY", "ENABLE_ETL_SCHEDULER", "GCP_PROJECT_ID", "BQ_DATASET"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      return fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }
  afterEach(async () => {
    const { stopEtlScheduler } = await import("../../analytics/scheduler/etl-scheduler");
    stopEtlScheduler();
  });

  async function captureInfo(fn: () => void): Promise<Array<{ msg: string; meta: Record<string, unknown> | undefined }>> {
    const { logger } = await import("../lib/logger");
    const seen: Array<{ msg: string; meta: Record<string, unknown> | undefined }> = [];
    const orig = logger.info.bind(logger);
    (logger as { info: typeof logger.info }).info = ((msg: string, meta?: Record<string, unknown>) => {
      seen.push({ msg, meta });
      return (orig as (...a: unknown[]) => unknown)(msg, meta);
    }) as typeof logger.info;
    try {
      fn();
    } finally {
      (logger as { info: typeof logger.info }).info = orig;
    }
    return seen;
  }

  it("the ETL scheduler does not start on a laptop that only has the gcloud login, and says why", async () => {
    const { startEtlScheduler } = await import("../../analytics/scheduler/etl-scheduler");
    const seen = await captureInfo(() => withEnv(laptop({ GOOGLE_APPLICATION_CREDENTIALS: keyFile, ENABLE_ETL_SCHEDULER: "true" }), () => startEtlScheduler()));
    expect(seen.map((e) => e.msg)).toContain("etl_scheduler_skipped");
    expect(seen.map((e) => e.msg)).not.toContain("etl_scheduler_started");
    expect(seen.find((e) => e.msg === "etl_scheduler_skipped")?.meta?.reason).toBe("local_egress_not_enabled");
  });

  it("the warehouse client is never constructed on a refused laptop — the caller sees the SDK's missing-credentials error", async () => {
    const { getBigQuery } = await import("../../analytics/etl/bq-client");
    let thrown: unknown;
    withEnv(laptop({ GOOGLE_APPLICATION_CREDENTIALS: keyFile }), () => {
      try {
        getBigQuery();
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(adc.BQ_NO_CREDENTIALS_MESSAGE);
    expect((thrown as { reason?: string }).reason).toBe("local_egress_not_enabled");
  });

  it("missing credentials on an otherwise authorized laptop: the scheduler skips instead of failing jobs", async () => {
    const { startEtlScheduler } = await import("../../analytics/scheduler/etl-scheduler");
    const seen = await captureInfo(() =>
      withEnv(authorizedLaptop({ GOOGLE_APPLICATION_CREDENTIALS: join(dir, "missing.json"), ENABLE_ETL_SCHEDULER: "true" }), () => startEtlScheduler()),
    );
    expect(seen.find((e) => e.msg === "etl_scheduler_skipped")?.meta?.reason).toBe("local_credentials_not_explicit");
    expect(seen.map((e) => e.msg)).not.toContain("etl_scheduler_started");
  });

  it("the ML services refuse on a refused laptop before building a client", async () => {
    withEnv(laptop(), () => {
      expect(() => adc.assertBqAdcAvailable()).toThrow(adc.BQ_NO_CREDENTIALS_MESSAGE);
    });
    withEnv({ NODE_ENV: "production", GCP_PROJECT_ID: "homigo-497619" }, () => {
      expect(() => adc.assertBqAdcAvailable()).not.toThrow();
    });
  });
});
