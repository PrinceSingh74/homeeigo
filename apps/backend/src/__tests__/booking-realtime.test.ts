import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { roomManager, MessageType } from "../lib/websocket";
import {
  ADMIN_NOTIFICATIONS_ROOM,
  BOOKING_STATUS_EVENT,
  publishBookingStatus,
} from "../lib/booking-realtime";

/**
 * The authoritative booking-status publisher must fan out to every surface that renders a
 * booking — the per-booking room, both parties' notification sockets and the admin room — from a
 * single call, and must never throw into the mutation that invoked it.
 */
describe("publishBookingStatus", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("fans out one transition to booking room, both user rooms and the admin room", async () => {
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
    const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
    spies.push(broadcast, sendToUser);

    await publishBookingStatus({
      bookingId: "bk_1",
      status: "EN_ROUTE",
      userId: "cust_1",
      providerUserId: "vend_1",
      extra: { enRouteAt: "2026-09-15T00:00:00.000Z" },
    });

    // Per-booking room: legacy BOOKING_STATUS shape, status lowercased.
    const roomCall = broadcast.mock.calls.find((c) => c[0] === "booking:bk_1");
    expect(roomCall).toBeDefined();
    expect(roomCall![1].type).toBe(MessageType.BOOKING_STATUS);
    expect(roomCall![1].data.status).toBe("en_route");
    expect(roomCall![1].data.bookingId).toBe("bk_1");
    expect(roomCall![1].data.enRouteAt).toBe("2026-09-15T00:00:00.000Z");

    // Admin room: enveloped booking.status with referenceId for the bridges.
    const adminCall = broadcast.mock.calls.find((c) => c[0] === ADMIN_NOTIFICATIONS_ROOM);
    expect(adminCall).toBeDefined();
    expect(adminCall![1].type).toBe(BOOKING_STATUS_EVENT);
    expect(adminCall![1].data.referenceId).toBe("bk_1");
    expect(adminCall![1].data.status).toBe("en_route");

    // Both parties' user rooms, each exactly once.
    const users = sendToUser.mock.calls.map((c) => c[0]);
    expect(users.sort()).toEqual(["cust_1", "vend_1"]);
    for (const call of sendToUser.mock.calls) {
      expect(call[1].type).toBe(BOOKING_STATUS_EVENT);
      expect(call[1].data.referenceId).toBe("bk_1");
      expect(call[1].data.referenceType).toBe("booking");
      expect(call[1].data.status).toBe("en_route");
      expect(typeof call[1].data.eventId).toBe("string");
    }
  });

  it("does not double-send when customer and partner are the same user", async () => {
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
    const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
    spies.push(broadcast, sendToUser);

    await publishBookingStatus({ bookingId: "bk_2", status: "COMPLETED", userId: "u", providerUserId: "u" });
    expect(sendToUser.mock.calls.length).toBe(1);
  });

  it("skips user rooms when ids are explicitly null and still hits booking + admin rooms", async () => {
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => 0);
    const sendToUser = spyOn(roomManager, "sendToUser").mockImplementation(() => undefined);
    spies.push(broadcast, sendToUser);

    await publishBookingStatus({ bookingId: "bk_3", status: "ASSIGNED", userId: null, providerUserId: null });
    expect(sendToUser.mock.calls.length).toBe(0);
    expect([...new Set(broadcast.mock.calls.map((c) => c[0]))].sort()).toEqual(["admin:notifications", "booking:bk_3"]);
    // X-29: the booking room gets the full frame for everyone except partners, and a partner-safe copy
    // for partners — together every member of the room hears the transition exactly once.
    const bookingRoom = broadcast.mock.calls.filter((c) => c[0] === "booking:bk_3").map((c) => c[2]);
    expect(bookingRoom).toEqual([{ exceptUserType: "vendor" }, { onlyUserType: "vendor" }]);
  });

  it("never throws into the caller when the transport fails", async () => {
    const broadcast = spyOn(roomManager, "broadcast").mockImplementation(() => {
      throw new Error("socket exploded");
    });
    spies.push(broadcast);
    await expect(
      publishBookingStatus({ bookingId: "bk_4", status: "ACCEPTED", userId: "c", providerUserId: "p" }),
    ).resolves.toBeUndefined();
  });
});
