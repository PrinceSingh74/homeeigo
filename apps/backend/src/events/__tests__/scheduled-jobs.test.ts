import { afterEach, describe, expect, test } from "bun:test";
import {
  clearJobHandlers,
  getJobHandler,
  listJobHandlers,
  registerJobHandler,
} from "../core/job-registry";
import { eventPlatformConfig } from "../core/config";

const noop = async () => undefined;

afterEach(() => clearJobHandlers());

describe("scheduled job registry", () => {
  test("registers and resolves a handler", () => {
    registerJobHandler({ jobType: "test.alpha", handler: noop });
    expect(getJobHandler("test.alpha")?.jobType).toBe("test.alpha");
  });

  test("unregistered job types resolve to undefined", () => {
    expect(getJobHandler("test.nonexistent")).toBeUndefined();
  });

  test("lists registered job types sorted", () => {
    registerJobHandler({ jobType: "test.zulu", handler: noop });
    registerJobHandler({ jobType: "test.alpha", handler: noop });
    expect(listJobHandlers()).toEqual(["test.alpha", "test.zulu"]);
  });

  test("re-registration replaces rather than duplicating", () => {
    registerJobHandler({ jobType: "test.alpha", handler: noop, maxAttempts: 1 });
    registerJobHandler({ jobType: "test.alpha", handler: noop, maxAttempts: 9 });
    expect(listJobHandlers()).toEqual(["test.alpha"]);
    expect(getJobHandler("test.alpha")?.maxAttempts).toBe(9);
  });

  test("per-job overrides are preserved", () => {
    registerJobHandler({ jobType: "test.strict", handler: noop, maxAttempts: 2, maxStalenessMs: 60_000 });
    const def = getJobHandler("test.strict");
    expect(def?.maxAttempts).toBe(2);
    expect(def?.maxStalenessMs).toBe(60_000);
  });

  test("a job may opt out of the staleness guard with null", () => {
    registerJobHandler({ jobType: "test.timeless", handler: noop, maxStalenessMs: null });
    expect(getJobHandler("test.timeless")?.maxStalenessMs).toBeNull();
  });
});

describe("scheduled job staleness policy", () => {
  // Mirrors the resolution in job-processor.executeJob: undefined falls back to the
  // platform default, null disables the guard, a number overrides it.
  const resolve = (perJob: number | null | undefined) =>
    perJob === undefined ? eventPlatformConfig.jobMaxStalenessMs : perJob;

  const isStale = (runAt: Date, limit: number | null) =>
    limit !== null && Date.now() - runAt.getTime() > limit;

  test("default staleness limit is configured and positive", () => {
    expect(eventPlatformConfig.jobMaxStalenessMs).toBeGreaterThan(0);
  });

  test("a job due far in the past is stale under the default policy", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000);
    expect(isStale(fourDaysAgo, resolve(undefined))).toBe(true);
  });

  test("a job due now is not stale", () => {
    expect(isStale(new Date(), resolve(undefined))).toBe(false);
  });

  test("null limit disables the staleness guard entirely", () => {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000);
    expect(isStale(yearAgo, resolve(null))).toBe(false);
  });

  test("a per-job limit overrides the platform default", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    expect(isStale(tenMinAgo, resolve(60_000))).toBe(true);
    expect(isStale(tenMinAgo, resolve(3_600_000))).toBe(false);
  });
});

describe("scheduled job config", () => {
  test("retry ceiling and lease are bounded and sane", () => {
    expect(eventPlatformConfig.jobMaxAttempts).toBeGreaterThanOrEqual(1);
    expect(eventPlatformConfig.jobLeaseMs).toBeGreaterThan(eventPlatformConfig.jobTimeoutMs);
    expect(eventPlatformConfig.jobBatchSize).toBeGreaterThan(0);
  });
});
