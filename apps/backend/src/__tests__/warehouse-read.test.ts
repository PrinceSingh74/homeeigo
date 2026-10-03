/**
 * The shared warehouse-read boundary (X-84 class: X-84, X-86, X-88, X-89, X-90).
 *
 * Every HTTP read of the data warehouse goes through `readWarehouse`, which never throws on a
 * warehouse failure: it answers `{ available: true, value }` or a stated unavailability carrying a
 * reason code and a diagnostic cause, and no figures. `isWarehouseOutage` separates "the warehouse
 * did not answer" (credentials, connection, deadline, garbage, its own 5xx / 429 / 403 billing or
 * access refusal) from "the query itself is wrong" (400 invalidQuery / 404 notFound), which is a
 * defect to surface, not an outage to hide.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyWarehouseFailure,
  isWarehouseOutage,
  readWarehouse,
  withWarehouseDeadline,
  WarehouseMalformedResponseError,
  WarehouseTimeoutError,
} from "../lib/warehouse-read";
import { WarehouseEgressRefusedError } from "../lib/bigquery-adc";

const apiError = (code: number, reason: string, message = reason) =>
  Object.assign(new Error(message), { code, errors: [{ reason, message }] });

describe("classifyWarehouseFailure", () => {
  test("names each outage shape", () => {
    expect(classifyWarehouseFailure(new WarehouseEgressRefusedError("local_egress_not_enabled"))).toBe("CREDENTIALS");
    expect(classifyWarehouseFailure(new Error("Could not load the default credentials. Browse to …"))).toBe("CREDENTIALS");
    expect(classifyWarehouseFailure(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("CONNECTION");
    expect(classifyWarehouseFailure(new WarehouseTimeoutError(50))).toBe("TIMEOUT");
    expect(classifyWarehouseFailure(new WarehouseMalformedResponseError("bad"))).toBe("MALFORMED_RESPONSE");
    expect(classifyWarehouseFailure(apiError(503, "backendError", "Retry limit exceeded"))).toBe("UPSTREAM_ERROR");
  });
});

describe("isWarehouseOutage", () => {
  test("the warehouse did not answer → outage", () => {
    expect(isWarehouseOutage(new WarehouseEgressRefusedError("local_egress_not_enabled"))).toBe(true);
    expect(isWarehouseOutage(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isWarehouseOutage(new WarehouseTimeoutError(50))).toBe(true);
    expect(isWarehouseOutage(new WarehouseMalformedResponseError("bad"))).toBe(true);
    expect(isWarehouseOutage(apiError(503, "backendError"))).toBe(true);
    expect(isWarehouseOutage(apiError(429, "rateLimitExceeded"))).toBe(true);
    // Live: the warehouse's billing is disabled.
    expect(isWarehouseOutage(apiError(403, "billingNotEnabled"))).toBe(true);
    expect(isWarehouseOutage(apiError(403, "accessDenied"))).toBe(true);
  });

  test("the query itself is wrong → not an outage (a defect to surface)", () => {
    expect(isWarehouseOutage(apiError(404, "notFound", "Not found: Table x"))).toBe(false);
    expect(isWarehouseOutage(apiError(400, "invalidQuery", "Syntax error"))).toBe(false);
    expect(isWarehouseOutage(new TypeError("cannot read properties of undefined"))).toBe(false);
  });
});

describe("withWarehouseDeadline", () => {
  test("a hung read rejects with WarehouseTimeoutError at the deadline", async () => {
    const t0 = Date.now();
    let err: unknown = null;
    try {
      await withWarehouseDeadline(new Promise(() => {}), 60);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WarehouseTimeoutError);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  test("a timely read passes through untouched", async () => {
    expect(await withWarehouseDeadline(Promise.resolve([1, 2]), 1_000)).toEqual([1, 2]);
  });
});

describe("readWarehouse", () => {
  const read = (run: () => Promise<unknown>) =>
    readWarehouse(run, { reasonCode: "TEST_SOURCE_UNAVAILABLE", logEvent: "test_unavailable", reason: "test", deadlineMs: 60 });

  test("healthy → available:true with the value", async () => {
    expect(await read(async () => ({ n: 3 }))).toEqual({ available: true, value: { n: 3 } });
  });

  test("each outage shape → a stated unavailability with no figures", async () => {
    const shapes: Array<[() => Promise<unknown>, string]> = [
      [async () => { throw new WarehouseEgressRefusedError("local_egress_not_enabled"); }, "CREDENTIALS"],
      [async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); }, "CONNECTION"],
      [() => new Promise(() => {}), "TIMEOUT"],
      [async () => { throw new WarehouseMalformedResponseError("bad rows"); }, "MALFORMED_RESPONSE"],
      [async () => { throw apiError(503, "backendError", "Retry limit exceeded"); }, "UPSTREAM_ERROR"],
    ];
    for (const [run, cause] of shapes) {
      const r = await read(run);
      expect(r).toMatchObject({ available: false, reasonCode: "TEST_SOURCE_UNAVAILABLE", cause, reason: "test", data: null });
    }
  });

  test("a query defect (404 / 400) or a programming error is NOT hidden as an outage — it throws", async () => {
    for (const e of [apiError(404, "notFound"), apiError(400, "invalidQuery"), new TypeError("boom")]) {
      let thrown: unknown = null;
      try {
        await read(async () => { throw e; });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBe(e);
    }
  });
});
