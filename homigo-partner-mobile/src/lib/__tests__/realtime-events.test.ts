import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventDeduper, parseRealtimeFrame, reconnectDelayMs } from "../realtime-events.ts";

test("system frames are ignored", () => {
  assert.equal(parseRealtimeFrame(JSON.stringify({ type: "PING" })), null);
  assert.equal(
    parseRealtimeFrame(JSON.stringify({ type: "SUBSCRIBE", data: { message: "Connected to notifications" } })),
    null,
  );
  assert.equal(parseRealtimeFrame("not json"), null);
});

test("booking.status (authoritative transition) refreshes bookings, dashboard, operations", () => {
  const f = parseRealtimeFrame(
    JSON.stringify({
      type: "booking.status",
      data: { eventId: "e1", type: "booking.status", bookingId: "b1", referenceType: "booking", status: "in_progress" },
    }),
  )!;
  assert.equal(f.dedupeKey, "e1");
  assert.equal(f.bookingId, "b1");
  assert.ok(f.targets.has("bookings") && f.targets.has("dashboard") && f.targets.has("operations"));
});

test("booking_dispatched (new offer) refreshes the offer list", () => {
  const f = parseRealtimeFrame(
    JSON.stringify({ type: "booking_dispatched", data: { eventId: "e2", type: "booking_dispatched", bookingId: "b2" } }),
  )!;
  assert.ok(f.targets.has("bookings"));
});

test("notification.created with WALLET_CREDIT refreshes wallet and notifications", () => {
  const f = parseRealtimeFrame(
    JSON.stringify({
      type: "notification.created",
      data: { eventId: "e3", id: "n1", type: "notification.created", notificationType: "WALLET_CREDIT" },
    }),
  )!;
  assert.ok(f.targets.has("wallet"));
  assert.ok(f.targets.has("notifications"));
});

test("EARNINGS_UPDATE envelope (no eventId) refreshes wallet and is not de-duplicated", () => {
  const f = parseRealtimeFrame(JSON.stringify({ type: "EARNINGS_UPDATE", data: { today: 100 } }))!;
  assert.ok(f.targets.has("wallet"));
  assert.equal(f.dedupeKey, null);
});

test("deduper drops replays and stays bounded", () => {
  const d = createEventDeduper(3);
  assert.equal(d.admit("a"), true);
  assert.equal(d.admit("a"), false);
  d.admit("b");
  d.admit("c");
  d.admit("d"); // evicts "a"
  assert.equal(d.size(), 3);
  assert.equal(d.admit("a"), true);
  assert.equal(d.admit(null), true);
  assert.equal(d.admit(null), true);
});

test("reconnect backoff grows and caps at 30 s", () => {
  const noJitter = () => 0.5;
  assert.equal(reconnectDelayMs(0, noJitter), 1_000);
  assert.equal(reconnectDelayMs(3, noJitter), 8_000);
  assert.equal(reconnectDelayMs(10, noJitter), 30_000);
  assert.ok(reconnectDelayMs(50, () => 1) <= 30_000);
});

// X-60: a safety hold released (or an incident resolved) arrives as a booking.requirement frame
// (apps/backend/src/lib/booking-realtime.ts). The job screen's panels — job actions (Start), safety,
// requirements, execution steps, quality — must refetch, or Start stays disabled until the job is reopened.
test("booking.requirement (gate / safety / step / quality frame) refreshes the job screen's panels", () => {
  const f = parseRealtimeFrame(
    JSON.stringify({
      type: "booking.requirement",
      data: {
        eventId: "e-req",
        type: "booking.requirement",
        bookingId: "b9",
        referenceId: "b9",
        referenceType: "booking",
        event: "execution.unblocked",
        code: "safety",
        state: "SAFETY_HOLD_RELEASED",
        gate: { ok: true, blocking: [] },
      },
    }),
  )!;
  assert.equal(f.bookingId, "b9");
  assert.ok(f.targets.has("execution"), "job panels must refetch");
  assert.ok(f.targets.has("bookings"));
});

test("a plain booking.status frame does not refetch every job panel", () => {
  const f = parseRealtimeFrame(JSON.stringify({ type: "booking.status", data: { eventId: "e-s", type: "booking.status", bookingId: "b1" } }))!;
  assert.equal(f.targets.has("execution"), false);
});
