import { afterEach, describe, expect, it } from "bun:test";
import {
  __resetBootHealthForTests,
  clearBootDegradation,
  getBootDegradations,
  isBootDegraded,
  markBootDegraded,
} from "../lib/boot-health";

describe("boot-health", () => {
  afterEach(() => __resetBootHealthForTests());

  it("starts healthy", () => {
    expect(isBootDegraded()).toBe(false);
    expect(getBootDegradations()).toEqual([]);
  });

  it("records a degradation with component, error and impact", () => {
    markBootDegraded("workflow_registry", new Error("No code for x.v1"), "outbox not started");
    expect(isBootDegraded()).toBe(true);
    const [d] = getBootDegradations();
    expect(d.component).toBe("workflow_registry");
    expect(d.error).toBe("No code for x.v1");
    expect(d.impact).toBe("outbox not started");
    expect(Number.isNaN(Date.parse(d.since))).toBe(false);
  });

  it("keeps one entry per component (latest wins) and clears on recovery", () => {
    markBootDegraded("a", "first", "i");
    markBootDegraded("a", "second", "i");
    markBootDegraded("b", "x", "i");
    expect(getBootDegradations().map((d) => `${d.component}:${d.error}`).sort()).toEqual(["a:second", "b:x"]);
    clearBootDegradation("a");
    expect(getBootDegradations().map((d) => d.component)).toEqual(["b"]);
    clearBootDegradation("b");
    expect(isBootDegraded()).toBe(false);
  });
});

describe("/ready reflects boot degradation", () => {
  afterEach(() => __resetBootHealthForTests());

  it("returns 503 with the degradation listed while a boot component is down", async () => {
    const { Elysia } = await import("elysia");
    const { observabilityRoutes } = await import("../routes/observability");
    const app = new Elysia().use(observabilityRoutes);

    markBootDegraded("workflow_registry", new Error("boom"), "outbox not started");
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { boot: { status: string; degradations: Array<{ component: string }> } } };
    expect(body.status).toBe("not_ready");
    expect(body.checks.boot.status).toBe("degraded");
    expect(body.checks.boot.degradations.map((d) => d.component)).toEqual(["workflow_registry"]);

    clearBootDegradation("workflow_registry");
    const after = await app.handle(new Request("http://localhost/ready"));
    const afterBody = (await after.json()) as { checks: { boot: { status: string }; database: { status: string } } };
    expect(afterBody.checks.boot.status).toBe("healthy");
    // Overall readiness now depends only on the real dependencies (DB/memory), whatever they are here.
    expect([200, 503]).toContain(after.status);
  });
});
