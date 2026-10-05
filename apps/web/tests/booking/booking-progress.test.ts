/**
 * The six-stage booking progress rail is derived only from what the API returned.
 *
 * Run from apps/web: `bun test tests/booking`.
 *
 * The rail this replaced stamped every reached stage with the moment the page was opened. These
 * tests pin the opposite: a stage has a time only when the server sent one, and a stage the server
 * holds no record of is never ticked.
 */
import { describe, expect, test } from "bun:test";
import { deriveBookingProgress, type ProgressStageId } from "@/lib/booking-progress";

const T = {
  enRoute: "2026-10-01T09:00:00.000Z",
  arrived: "2026-10-01T09:20:00.000Z",
  pin: "2026-10-01T09:22:00.000Z",
  started: "2026-10-01T09:22:05.000Z",
  completed: "2026-10-01T10:30:00.000Z",
  verdict: "2026-10-01T10:30:01.000Z",
  confirmBy: "2026-10-03T10:30:00.000Z",
  resolved: "2026-10-01T11:00:00.000Z",
};

const byId = (p: ReturnType<typeof deriveBookingProgress>) =>
  Object.fromEntries(p.stages.map((s) => [s.id, s])) as Record<ProgressStageId, (typeof p.stages)[number]>;

describe("deriveBookingProgress", () => {
  test("always six stages, in the order of the real visit", () => {
    const p = deriveBookingProgress({ booking: { status: "pending" } });
    expect(p.stages.map((s) => s.id)).toEqual(["arrival", "start_check", "service_started", "work", "quality_check", "completion"]);
    expect(p.stages.every((s) => s.state === "upcoming" && s.at === null && s.dueAt === null)).toBe(true);
    expect(p.ended).toBeNull();
  });

  test("a missing booking is all upcoming, with no times", () => {
    const p = deriveBookingProgress({ booking: null });
    expect(p.stages.every((s) => s.state === "upcoming" && s.at === null)).toBe(true);
  });

  test("on the way: arrival is the current stage and carries no arrival time", () => {
    const s = byId(deriveBookingProgress({ booking: { status: "en_route", enRouteAt: T.enRoute } }));
    expect(s.arrival.state).toBe("current");
    expect(s.arrival.at).toBeNull();
    expect(s.start_check.state).toBe("upcoming");
  });

  test("arrived: arrival is done at the server's time; the start check is current", () => {
    const s = byId(
      deriveBookingProgress({
        booking: { status: "en_route", enRouteAt: T.enRoute, arrivedAt: T.arrived },
        startPin: { state: "active", verifiedAt: null },
      }),
    );
    expect(s.arrival).toMatchObject({ state: "done", at: T.arrived });
    expect(s.start_check.state).toBe("current");
    expect(s.start_check.detail).toContain("PIN");
    expect(s.service_started.state).toBe("upcoming");
  });

  test("in progress: PIN and start carry their own times; work shows the step count", () => {
    const s = byId(
      deriveBookingProgress({
        booking: { status: "in_progress", arrivedAt: T.arrived, startedAt: T.started },
        startPin: { state: "verified", verifiedAt: T.pin },
        execution: { enforced: true, steps: [{ state: "COMPLETED" }, { state: "IN_PROGRESS" }, { state: "PENDING" }] },
      }),
    );
    expect(s.start_check).toMatchObject({ state: "done", at: T.pin });
    expect(s.service_started).toMatchObject({ state: "done", at: T.started });
    expect(s.work).toMatchObject({ state: "current", at: null, detail: "1 of 3 steps done" });
    expect(s.quality_check.state).toBe("upcoming");
  });

  test("a stage is done without a time when the server sent none — never a made-up one", () => {
    const s = byId(deriveBookingProgress({ booking: { status: "in_progress" } }));
    expect(s.arrival).toMatchObject({ state: "done", at: null });
    expect(s.service_started).toMatchObject({ state: "done", at: null });
  });

  test("started with no verified PIN: the start check is not ticked", () => {
    const known = byId(deriveBookingProgress({ booking: { status: "in_progress", startedAt: T.started }, startPin: { state: "waiting", verifiedAt: null } }));
    expect(known.start_check.state).toBe("skipped");
    expect(known.start_check.detail).not.toBeNull();
    const unknown = byId(deriveBookingProgress({ booking: { status: "in_progress", startedAt: T.started } }));
    expect(unknown.start_check).toMatchObject({ state: "skipped", detail: null });
  });

  test("unenforced execution contributes no step count", () => {
    const s = byId(deriveBookingProgress({ booking: { status: "in_progress" }, execution: { enforced: false, steps: [{ state: "COMPLETED" }] } }));
    expect(s.work.detail).toBeNull();
  });

  test("completed, awaiting the customer: the deadline is the server's confirmBy", () => {
    const s = byId(
      deriveBookingProgress({
        booking: { status: "completed", arrivedAt: T.arrived, startedAt: T.started, completedAt: T.completed },
        startPin: { state: "verified", verifiedAt: T.pin },
        completion: {
          completion: { state: "PENDING_CUSTOMER", confirmBy: T.confirmBy, resolvedAt: null },
          verdict: { label: "The work passed our checks", at: T.verdict },
        },
      }),
    );
    expect(s.work).toMatchObject({ state: "done", at: T.completed });
    expect(s.quality_check).toMatchObject({ state: "done", at: T.verdict, detail: "The work passed our checks" });
    expect(s.completion).toMatchObject({ state: "current", at: null, dueAt: T.confirmBy });
  });

  test("confirmed, auto-confirmed and issue-reported each say which it was", () => {
    const run = (state: string) =>
      byId(
        deriveBookingProgress({
          booking: { status: "completed", completedAt: T.completed },
          completion: { completion: { state, confirmBy: T.confirmBy, resolvedAt: T.resolved }, verdict: null },
        }),
      ).completion;
    expect(run("CONFIRMED")).toMatchObject({ state: "done", label: "Confirmed by you", at: T.resolved });
    expect(run("AUTO_CONFIRMED")).toMatchObject({ state: "done", label: "Confirmed automatically", at: T.resolved });
    expect(run("ISSUE_REPORTED")).toMatchObject({ state: "attention", label: "Issue reported" });
  });

  test("completed with no verdict and no confirmation row: no quality tick, plain Completed", () => {
    const s = byId(deriveBookingProgress({ booking: { status: "completed", completedAt: T.completed }, completion: { completion: null, verdict: null } }));
    expect(s.quality_check).toMatchObject({ state: "skipped", at: null });
    expect(s.completion).toMatchObject({ state: "done", label: "Completed", at: T.completed });
  });

  test("a cancelled booking keeps what happened and marks the rest not reached", () => {
    const p = deriveBookingProgress({ booking: { status: "cancelled_by_user", enRouteAt: T.enRoute, arrivedAt: T.arrived } });
    const s = byId(p);
    expect(p.ended).toBe("cancelled");
    expect(s.arrival).toMatchObject({ state: "done", at: T.arrived });
    expect(p.stages.slice(1).every((x) => x.state === "not_reached")).toBe(true);
  });

  test("every ending is named; none is shown as progress", () => {
    for (const [status, end] of [["EXPIRED", "expired"], ["CUSTOMER_NO_SHOW", "customer_no_show"], ["PROVIDER_NO_SHOW", "provider_no_show"], ["REJECTED", "cancelled"], ["CANCELLED_BY_PROVIDER", "cancelled"]] as const) {
      const p = deriveBookingProgress({ booking: { status } });
      expect(p.ended).toBe(end);
      expect(p.stages.some((x) => x.state === "current" || x.state === "upcoming" || x.state === "done")).toBe(false);
    }
  });

  test("Date timestamps are accepted and returned as ISO strings", () => {
    const s = byId(deriveBookingProgress({ booking: { status: "in_progress", startedAt: new Date(T.started) } }));
    expect(s.service_started.at).toBe(T.started);
  });
});
