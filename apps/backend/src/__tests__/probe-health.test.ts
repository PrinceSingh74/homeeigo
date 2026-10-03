/**
 * Liveness / readiness probes and the shared dependency check (2026-10-01).
 */
import "../load-env";
import { describe, expect, test } from "bun:test";
import app from "../index";
import { createDependencyProbe, markDraining, resetDrainingForTests, shutdownDrainMs } from "../lib/probe-health";

const get = (path: string) => app.handle(new Request(`http://localhost${path}`));

describe("dependency probe", () => {
  test("a burst of 50 concurrent probes runs the check once", async () => {
    let calls = 0;
    const probe = createDependencyProbe(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { database: "ok", redis: "disabled" };
    }, 1_000);
    const results = await Promise.all(Array.from({ length: 50 }, () => probe()));
    expect(calls).toBe(1);
    expect(results.every((r) => r.database === "ok")).toBe(true);
    await probe(); // still inside the TTL
    expect(calls).toBe(1);
  });

  test("an expired cache re-checks", async () => {
    let calls = 0;
    const probe = createDependencyProbe(async () => {
      calls++;
      return { database: calls === 1 ? "ok" : "down", redis: "disabled" };
    }, 10);
    expect((await probe()).database).toBe("ok");
    await new Promise((r) => setTimeout(r, 25));
    expect((await probe()).database).toBe("down");
  });

  test("drain period: explicit setting wins, deployed hosts default to 5 s, laptops to 0", () => {
    const saved = process.env.SHUTDOWN_DRAIN_MS;
    try {
      delete process.env.SHUTDOWN_DRAIN_MS;
      expect(shutdownDrainMs(true)).toBe(5_000);
      expect(shutdownDrainMs(false)).toBe(0);
      process.env.SHUTDOWN_DRAIN_MS = "1500";
      expect(shutdownDrainMs(false)).toBe(1_500);
    } finally {
      if (saved === undefined) delete process.env.SHUTDOWN_DRAIN_MS;
      else process.env.SHUTDOWN_DRAIN_MS = saved;
    }
  });
});

describe("probe endpoints", () => {
  test("/livez answers without consulting dependencies; /readyz is ready on a healthy test stack", async () => {
    const live = await get("/livez");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "alive" });
    const ready = await get("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  // Draining is one-way in production; the reset exists only because test files share this process.
  test("/readyz goes 503 once the instance starts draining; /livez stays 200", async () => {
    markDraining();
    try {
      const ready = await get("/readyz");
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "draining" });
      expect((await get("/livez")).status).toBe(200);
    } finally {
      resetDrainingForTests();
    }
  });
});
