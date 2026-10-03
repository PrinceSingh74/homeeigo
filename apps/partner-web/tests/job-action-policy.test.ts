/**
 * The partner job axis, as this app computes it.
 *
 * `apps/partner-web` had no unit-test harness at all until this file. It uses the same one
 * `apps/web` uses — `bun test` with the `@/` alias straight from tsconfig — rather than adding a
 * second testing stack to the repository. Run from `apps/partner-web`:
 *
 *     bun test tests
 *
 * What it guards is the mirror problem. This module is a deliberate copy of the backend's
 * `partner-job-fsm` / `job-action-policy`, kept so the app can render CTAs from a cached list row
 * before the server answers. A copy that drifts is worse than no copy: on 2026-09-23 all three
 * copies derived `CUSTOMER_NO_SHOW` as `ARRIVED`, so the partner app offered "Start service" on a
 * booking that was already closed and refunded, and `EXPIRED` as `OFFERED`, offering *Accept* on a
 * slot the server had already released.
 */
import { describe, expect, test } from "bun:test";
import { getAvailableJobActions } from "@/lib/job-action-policy";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** A row with every timestamp a live job would carry — the shape that used to fool the derivation. */
const fullyTimestamped = (status: string) =>
  ({
    status,
    enRouteAt: minutesAgo(90),
    arrivedAt: minutesAgo(60),
    paymentStatus: "SUCCESS",
  }) as never;

describe("terminal statuses end the job, whatever the timestamps say", () => {
  for (const status of ["EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"]) {
    test(`${status} offers the partner nothing`, () => {
      const r = getAvailableJobActions(fullyTimestamped(status));
      expect(r.stage).toBe(status as never);
      expect(r.availableActions).toEqual([]);
      expect(r.primaryAction).toBeNull();
    });

    test(`${status} never renders as an executable stage`, () => {
      const r = getAvailableJobActions(fullyTimestamped(status));
      for (const forbidden of ["ARRIVED", "STARTED", "IN_PROGRESS", "OFFERED", "ACCEPTED", "EN_ROUTE"]) {
        expect(r.stage).not.toBe(forbidden as never);
      }
    });
  }

  test("CUSTOMER_NO_SHOW is specifically not startable — the failure this file exists for", () => {
    const r = getAvailableJobActions(fullyTimestamped("CUSTOMER_NO_SHOW"));
    expect(r.availableActions).not.toContain("START_SERVICE");
    expect(r.availableActions).not.toContain("COMPLETE_SERVICE");
  });

  test("EXPIRED is specifically not acceptable — the slot was already released", () => {
    const r = getAvailableJobActions({ status: "EXPIRED", paymentStatus: "PENDING" } as never);
    expect(r.availableActions).not.toContain("ACCEPT");
    expect(r.availableActions).not.toContain("DECLINE");
  });

  test("cancellation and rejection stay terminal too — this did not replace them", () => {
    for (const status of ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED"]) {
      const r = getAvailableJobActions(fullyTimestamped(status));
      expect(r.availableActions).toEqual([]);
    }
  });
});

describe("a live job is still live — the guard did not disable the app", () => {
  test("the identical row on EN_ROUTE is ARRIVED and startable", () => {
    const r = getAvailableJobActions(fullyTimestamped("EN_ROUTE"));
    expect(r.stage).toBe("ARRIVED");
    expect(r.primaryAction).toBe("START_SERVICE");
  });

  test("an offered job can be accepted", () => {
    const r = getAvailableJobActions({ status: "PENDING", paymentStatus: "SUCCESS" } as never);
    expect(r.stage).toBe("OFFERED");
    expect(r.availableActions).toContain("ACCEPT");
    expect(r.availableActions).toContain("DECLINE");
  });

  test("an accepted job navigates rather than starting", () => {
    const r = getAvailableJobActions({ status: "ACCEPTED", paymentStatus: "SUCCESS" } as never);
    expect(r.stage).toBe("ACCEPTED");
    expect(r.primaryAction).toBe("START_NAVIGATION");
  });

  test("a completed job is finished but still reachable for chat and evidence", () => {
    const r = getAvailableJobActions({
      status: "COMPLETED",
      completedAt: minutesAgo(10),
      paymentStatus: "SUCCESS",
    } as never);
    expect(r.stage).toBe("COMPLETED");
    expect(r.availableActions).not.toContain("START_SERVICE");
  });
});

describe("authorization-shaped gating the partner UI must respect", () => {
  test("an unsettled payment blocks starting, and says why", () => {
    const r = getAvailableJobActions({
      status: "EN_ROUTE",
      arrivedAt: minutesAgo(5),
      paymentStatus: "PENDING",
    } as never);
    expect(r.requiredGates).toContain("PAYMENT_SETTLED");
    expect(r.disabledReasons.START_SERVICE).toBeTruthy();
  });

  test("the start OTP gate is declared at the door", () => {
    const r = getAvailableJobActions({
      status: "EN_ROUTE",
      arrivedAt: minutesAgo(5),
      paymentStatus: "SUCCESS",
    } as never);
    expect(r.requiredGates).toContain("START_OTP_VERIFIED");
  });
});
