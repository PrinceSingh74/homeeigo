import { describe, expect, it } from "bun:test";
import { RoomManager, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, type WSConnection } from "../lib/websocket";

/**
 * Room membership is granted once at open(); these cases prove it can be withdrawn. Pure in-memory —
 * no Redis, no DB — so the contract is the RoomManager's alone.
 */
function conn(rm: RoomManager, userId: string, rooms: string[], extra: Partial<WSConnection> = {}) {
  const sent: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const c: WSConnection = {
    userId,
    userType: "vendor",
    connectionId: `c_${Math.random().toString(36).slice(2)}`,
    connectedAt: new Date(),
    lastPing: new Date(),
    rooms: new Set(),
    send: (m) => sent.push(m),
    close: (code, reason) => closed.push({ code, reason }),
    ...extra,
  };
  for (const r of rooms) rm.addToRoom(r, c);
  return { c, sent, closed };
}

describe("RoomManager.evictUser", () => {
  it("removes only the named rooms and closes the socket once it has no room left", () => {
    const rm = new RoomManager();
    const partner = conn(rm, "u_partner", ["booking:B1"]);
    const partnerNotif = conn(rm, "u_partner", ["user:u_partner"]);
    const customer = conn(rm, "u_customer", ["booking:B1"]);

    const closed = rm.evictUser({ userId: "u_partner", roomIds: ["booking:B1", "tracking:B1"], code: WS_CLOSE_FORBIDDEN, reason: "reassigned" });

    expect(closed).toBe(1);
    expect(partner.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "reassigned" }]);
    expect(rm.getRoom("booking:B1").has(partner.c)).toBe(false);
    // The customer keeps the room; the partner keeps their notifications socket.
    expect(rm.getRoom("booking:B1").has(customer.c)).toBe(true);
    expect(partnerNotif.closed).toEqual([]);
    expect(rm.getRoom("user:u_partner").has(partnerNotif.c)).toBe(true);

    // Frames published after eviction do not reach the evicted socket.
    rm.broadcast("booking:B1", { type: "BOOKING_STATUS", data: { status: "assigned" }, timestamp: new Date() });
    expect(partner.sent).toEqual([]);
    expect(customer.sent.length).toBe(1);
  });

  it("without roomIds leaves every room and closes every socket of the user", () => {
    const rm = new RoomManager();
    const a = conn(rm, "u1", ["booking:B1", "tracking:B1"]);
    const b = conn(rm, "u1", ["user:u1", "admin:notifications"]);
    const other = conn(rm, "u2", ["admin:notifications"]);

    expect(rm.evictUser({ userId: "u1", code: WS_CLOSE_FORBIDDEN, reason: "role_changed" })).toBe(2);
    expect(a.closed[0]?.code).toBe(WS_CLOSE_FORBIDDEN);
    expect(b.closed[0]?.reason).toBe("role_changed");
    expect(rm.getUserConnections("u1").size).toBe(0);
    expect(rm.getRoom("admin:notifications").has(other.c)).toBe(true);
    expect(rm.getStats().totalConnections).toBe(1);
  });

  it("with a jti only the socket opened with that token is closed", () => {
    const rm = new RoomManager();
    const phone = conn(rm, "u1", ["user:u1"], { jti: "jti_phone" });
    const laptop = conn(rm, "u1", ["user:u1"], { jti: "jti_laptop" });
    rm.evictUser({ userId: "u1", jti: "jti_phone", code: WS_CLOSE_UNAUTHORIZED, reason: "token_revoked" });
    expect(phone.closed.length).toBe(1);
    expect(laptop.closed.length).toBe(0);
    expect(rm.getRoom("user:u1").has(laptop.c)).toBe(true);
  });

  it("is a no-op for an unknown user or a user not in the named rooms", () => {
    const rm = new RoomManager();
    const c = conn(rm, "u1", ["user:u1"]);
    expect(rm.evictUser({ userId: "nobody", code: 4403, reason: "x" })).toBe(0);
    expect(rm.evictUser({ userId: "u1", roomIds: ["booking:other"], code: 4403, reason: "x" })).toBe(0);
    expect(c.closed).toEqual([]);
  });
});

describe("RoomManager.sweepExpiredTokens", () => {
  it("closes sockets whose access token has expired and leaves the rest", () => {
    const rm = new RoomManager();
    const now = 1_800_000_000;
    const expired = conn(rm, "u1", ["booking:B1"], { jti: "j1", tokenExp: now - 1 });
    const live = conn(rm, "u1", ["user:u1"], { jti: "j2", tokenExp: now + 600 });
    const legacy = conn(rm, "u2", ["user:u2"]); // no exp claim: never swept, bounded by disconnect only

    expect(rm.sweepExpiredTokens(now)).toBe(1);
    expect(expired.closed).toEqual([{ code: WS_CLOSE_UNAUTHORIZED, reason: "token_expired" }]);
    expect(live.closed).toEqual([]);
    expect(legacy.closed).toEqual([]);
    expect(rm.getRoom("booking:B1").size).toBe(0);
  });
});

describe("cross-instance eviction envelope", () => {
  it("a peer's evict envelope is applied locally; own echoes are ignored", () => {
    const rm = new RoomManager();
    const c = conn(rm, "u1", ["booking:B1"]);
    rm.applyFanoutEnvelope({ kind: "evict", origin: rm.instance, criteria: { userId: "u1", code: 4403, reason: "reassigned" } });
    expect(c.closed).toEqual([]);
    rm.applyFanoutEnvelope({ kind: "evict", origin: "inst_peer", criteria: { userId: "u1", roomIds: ["booking:B1"], code: 4403, reason: "reassigned" } });
    expect(c.closed.length).toBe(1);
    expect(rm.getRoom("booking:B1").size).toBe(0);
  });
});
