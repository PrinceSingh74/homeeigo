/**
 * Partner presence — pure unit tests (no DB).
 */
import { describe, expect, test } from "bun:test";
import {
  derivePresenceFreshness,
  deriveLocationFreshness,
  isOperationallyLive,
  PRESENCE_FRESH_SEC,
  PRESENCE_STALE_SEC,
  LOCATION_FRESH_SEC,
} from "../lib/partner-presence-freshness";
import {
  validatePresenceLocation,
  validateClientTimestamp,
} from "../lib/partner-presence-location";

describe("partner-presence-freshness", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  test("FRESH / STALE / EXPIRED boundaries", () => {
    expect(
      derivePresenceFreshness({
        lastHeartbeatAt: new Date(now.getTime() - PRESENCE_FRESH_SEC * 1000),
        now,
      }),
    ).toBe("FRESH");
    expect(
      derivePresenceFreshness({
        lastHeartbeatAt: new Date(now.getTime() - (PRESENCE_FRESH_SEC + 1) * 1000),
        now,
      }),
    ).toBe("STALE");
    expect(
      derivePresenceFreshness({
        lastHeartbeatAt: new Date(now.getTime() - (PRESENCE_STALE_SEC + 1) * 1000),
        now,
      }),
    ).toBe("EXPIRED");
    expect(derivePresenceFreshness({ lastHeartbeatAt: null, now })).toBe("EXPIRED");
  });

  test("location freshness boundaries", () => {
    expect(
      deriveLocationFreshness({
        lastLocationAt: new Date(now.getTime() - LOCATION_FRESH_SEC * 1000),
        now,
      }),
    ).toBe("FRESH");
    expect(deriveLocationFreshness({ lastLocationAt: null, now })).toBe("EXPIRED");
  });

  test("isOperationallyLive requires online + non-expired heartbeat", () => {
    const fresh = new Date(now.getTime() - 5_000);
    expect(isOperationallyLive({ isOnline: true, lastHeartbeatAt: fresh, now })).toBe(true);
    expect(isOperationallyLive({ isOnline: false, lastHeartbeatAt: fresh, now })).toBe(false);
    expect(
      isOperationallyLive({
        isOnline: true,
        lastHeartbeatAt: new Date(now.getTime() - (PRESENCE_STALE_SEC + 5) * 1000),
        now,
      }),
    ).toBe(false);
  });
});

describe("partner-presence-location validation", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  test("rejects bad coordinates", () => {
    expect(
      validatePresenceLocation(
        { latitude: 91, longitude: 0, capturedAt: now },
        null,
        now,
      ).ok,
    ).toBe(false);
    expect(
      validatePresenceLocation(
        { latitude: 0, longitude: 0, capturedAt: now },
        null,
        now,
      ).ok,
    ).toBe(false);
  });

  test("rejects future and old timestamps", () => {
    const future = new Date(now.getTime() + 120_000);
    expect(validateClientTimestamp(future, now).ok).toBe(false);
    const old = new Date(now.getTime() - 600_000);
    expect(validateClientTimestamp(old, now).ok).toBe(false);
  });

  test("detects duplicate locations", () => {
    const prior = { latitude: 19.076, longitude: 72.8777, capturedAt: new Date(now.getTime() - 2000) };
    const dup = validatePresenceLocation(
      { latitude: 19.076, longitude: 72.8777, capturedAt: new Date(now.getTime() - 1000) },
      prior,
      now,
    );
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.duplicate).toBe(true);
  });

  test("detects impossible jumps", () => {
    const prior = {
      latitude: 19.076,
      longitude: 72.8777,
      capturedAt: new Date(now.getTime() - 1000),
    };
    const jump = validatePresenceLocation(
      { latitude: 28.6139, longitude: 77.209, capturedAt: now },
      prior,
      now,
    );
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.code).toBe("IMPOSSIBLE_JUMP");
  });

  test("sequence regression rejected", () => {
    const prior = {
      latitude: 19.076,
      longitude: 72.8777,
      capturedAt: new Date(now.getTime() - 5000),
      sequence: 5,
    };
    const reg = validatePresenceLocation(
      {
        latitude: 19.077,
        longitude: 72.878,
        capturedAt: now,
        sequence: 5,
      },
      prior,
      now,
    );
    expect(reg.ok).toBe(false);
    if (!reg.ok) expect(reg.code).toBe("SEQUENCE_REGRESSION");
  });
});

// Release certification Ph14: a Date.now()-style sequence overflowed the INT4 column and the
// heartbeat answered 500. The schema now bounds it, so parseBody turns it into a 400.
import { partnerPresenceHeartbeatSchema, partnerLocationPingSchema } from "../schemas/partner-presence.schema";

describe("presence location sequence is bounded to INT4", () => {
  const base = { sessionId: "cmsession000000000000000000", deviceId: "d1" };
  const loc = (sequence: number) => ({ latitude: 28.6, longitude: 77.3, capturedAt: new Date().toISOString(), sequence });

  test("INT4 max is accepted", () => {
    expect(partnerPresenceHeartbeatSchema.safeParse({ ...base, timestamp: new Date().toISOString(), location: loc(2_147_483_647) }).success).toBe(true);
    expect(partnerLocationPingSchema.safeParse({ ...base, location: loc(2_147_483_647) }).success).toBe(true);
  });

  test("a millisecond timestamp as sequence is rejected (was a DB 500)", () => {
    expect(partnerPresenceHeartbeatSchema.safeParse({ ...base, timestamp: new Date().toISOString(), location: loc(Date.now()) }).success).toBe(false);
    expect(partnerLocationPingSchema.safeParse({ ...base, location: loc(2_147_483_648) }).success).toBe(false);
  });
});
