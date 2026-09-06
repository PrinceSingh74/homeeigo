import { describe, expect, test } from "bun:test";
import { assertJobTransition, canTransitionJob, deriveJobState } from "../lib/partner-job-fsm";
import { JOB_STATES } from "../lib/partner-four-axis";

describe("partner job FSM", () => {
  test("happy path OFFERED → … → COMPLETED", () => {
    const path = [
      ["OFFERED", "ACCEPTED"],
      ["ACCEPTED", "EN_ROUTE"],
      ["EN_ROUTE", "ARRIVED"],
      ["ARRIVED", "STARTED"],
      ["STARTED", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransitionJob(from, to)).toBe(true);
    }
  });

  test("cannot skip or mix finance into the job machine", () => {
    expect(canTransitionJob("OFFERED", "IN_PROGRESS")).toBe(false);
    expect(() => assertJobTransition("ACCEPTED", "COMPLETED")).toThrow(/INVALID_TRANSITION/);
    expect((JOB_STATES as readonly string[]).includes("EARNING_POSTED")).toBe(false);
  });

  test("projects booking persistence onto the job axis", () => {
    expect(deriveJobState({ status: "PENDING" })).toBe("OFFERED");
    expect(deriveJobState({ status: "ASSIGNED" })).toBe("ACCEPTED");
    expect(deriveJobState({ status: "EN_ROUTE", arrivedAt: new Date() })).toBe("ARRIVED");
    expect(
      deriveJobState({
        status: "EN_ROUTE",
        arrivedAt: new Date(),
        startOtpVerifiedAt: new Date(),
      }),
    ).toBe("STARTED");
    expect(deriveJobState({ status: "IN_PROGRESS", startedAt: new Date() })).toBe("IN_PROGRESS");
    expect(deriveJobState({ status: "COMPLETED" })).toBe("COMPLETED");
    expect(deriveJobState({ status: "CANCELLED_BY_USER" })).toBe("CANCELLED");
  });
});
