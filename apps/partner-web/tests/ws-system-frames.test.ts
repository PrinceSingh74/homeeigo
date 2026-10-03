/**
 * Realtime state application: which frames are allowed to move the UI.
 *
 * `isSystemWsPayload` is the filter that stops control traffic from being mistaken for business
 * events. Getting it wrong is quiet in both directions and neither is visible in a happy-path demo:
 *
 *   too permissive — a PING re-renders the job list and invalidates queries on every heartbeat;
 *   too strict     — a real booking update is swallowed and the partner keeps seeing a stale job.
 *
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { isSystemWsPayload } from "@/lib/ws-system-frames";

describe("control frames never reach the UI", () => {
  for (const type of ["PING", "PONG", "SUBSCRIBE", "UNSUBSCRIBE", "ping", "Pong", "subscribe"]) {
    test(`${type} is a system frame`, () => {
      expect(isSystemWsPayload(JSON.stringify({ type }))).toBe(true);
    });
  }

  test("the bare connection greeting is a system frame", () => {
    expect(isSystemWsPayload(JSON.stringify({ message: "Connected to notifications" }))).toBe(true);
  });
});

describe("business frames always do", () => {
  test("a booking status change is not a system frame", () => {
    expect(isSystemWsPayload(JSON.stringify({ type: "BOOKING_STATUS", data: { status: "en_route" } }))).toBe(false);
  });

  test("the new terminal statuses are business frames, not swallowed", () => {
    // The point of the whole no-show/expiry work is that these reach an open app. A filter that
    // ate them would leave a partner staring at a job that had already been closed.
    for (const status of ["customer_no_show", "provider_no_show", "expired"]) {
      const frame = JSON.stringify({ type: "BOOKING_STATUS", data: { bookingId: "b1", status } });
      expect(isSystemWsPayload(frame), `${status} was treated as a control frame`).toBe(false);
    }
  });

  test("a greeting that CARRIES a notification is business, not control", () => {
    // The guard is deliberately narrow: the plain greeting is noise, but the same words attached to
    // a real notification id must still update the UI.
    const withId = JSON.stringify({ message: "Connected to notifications", id: "n_1" });
    const withType = JSON.stringify({ message: "Connected to notifications", notificationType: "booking" });
    expect(isSystemWsPayload(withId)).toBe(false);
    expect(isSystemWsPayload(withType)).toBe(false);
  });
});

describe("malformed input cannot crash the socket handler", () => {
  for (const raw of ["", "not json", "{", "[]", "null", "123", '{"type":null}']) {
    test(`${JSON.stringify(raw)} is handled without throwing`, () => {
      expect(() => isSystemWsPayload(raw)).not.toThrow();
    });
  }
});
