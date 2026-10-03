import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOfferCountdown, describeAcceptFailure, formatCountdown, isOfferLive } from "../offer.ts";
import { recordServerDate, resetServerClock, serverNow } from "../server-clock.ts";

const offer = { dispatchedAt: "2026-09-19T10:00:00.000Z", expiresAt: "2026-09-19T10:05:00.000Z" };
const at = (iso: string) => Date.parse(iso);

test("countdown counts to the deadline and expires exactly at expiresAt", () => {
  const mid = computeOfferCountdown(offer, at("2026-09-19T10:02:30.000Z"))!;
  assert.equal(mid.secondsLeft, 150);
  assert.equal(mid.expired, false);
  assert.equal(mid.urgency, "warning");
  const end = computeOfferCountdown(offer, at("2026-09-19T10:05:00.000Z"))!;
  assert.equal(end.expired, true);
  assert.equal(end.secondsLeft, 0);
  const after = computeOfferCountdown(offer, at("2026-09-19T10:06:00.000Z"))!;
  assert.equal(after.secondsLeft, 0); // never negative
  assert.equal(isOfferLive(offer, at("2026-09-19T10:04:59.000Z")), true);
  assert.equal(isOfferLive(offer, at("2026-09-19T10:05:00.000Z")), false);
});

test("no window means not a live offer; malformed means null", () => {
  assert.equal(isOfferLive(null, Date.now()), false);
  assert.equal(computeOfferCountdown({ dispatchedAt: "x", expiresAt: "y" }, 0), null);
});

test("formatCountdown", () => {
  assert.equal(formatCountdown(245), "4:05");
  assert.equal(formatCountdown(9), "0:09");
  assert.equal(formatCountdown(-3), "0:00");
});

test("accept errors map to actionable copy; gone offers are flagged for removal", () => {
  for (const code of ["ALREADY_CLAIMED", "NOT_FOUND", "INVALID_STATUS"]) {
    assert.equal(describeAcceptFailure(code).offerGone, true, code);
  }
  for (const code of ["PAYMENT_NOT_SETTLED", "CAPACITY_LIMIT", "STALE_PRESENCE", "STALE_LOCATION", "PROVIDER_UNAVAILABLE"]) {
    const f = describeAcceptFailure(code);
    assert.equal(f.offerGone, false, code);
    assert.ok(f.message.length > 10, code);
  }
  assert.equal(describeAcceptFailure("SOMETHING_NEW", "Server said so").message, "Server said so");
});

test("server clock: offset from the HTTP Date header, ignoring slow samples", () => {
  resetServerClock();
  assert.equal(serverNow(1_000), 1_000); // no sample: device clock
  // Device thinks it is 10:00:00; server says 10:01:00, so the estimate is about +60.5 s.
  const device = at("2026-09-19T10:00:00.000Z");
  recordServerDate("Sat, 19 Sep 2026 10:01:00 GMT", device - 100, device + 100);
  const est = serverNow(device);
  assert.ok(Math.abs(est - at("2026-09-19T10:01:00.500Z")) < 5, String(est));
  // A 5 s round trip is discarded.
  recordServerDate("Sat, 19 Sep 2026 12:00:00 GMT", device, device + 5_000);
  assert.ok(Math.abs(serverNow(device) - at("2026-09-19T10:01:00.500Z")) < 5);
  resetServerClock();
});
