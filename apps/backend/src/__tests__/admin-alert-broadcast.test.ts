import { describe, expect, test, beforeEach } from "bun:test";
import {
  ADMIN_OPS_ROOM,
  alertKey,
  getAdminAlertSubscriberCount,
  resetAdminAlertBroadcastState,
  tryBroadcastAdminAlert,
} from "../lib/admin-alert-broadcast";
import { roomManager } from "../lib/websocket";

describe("admin alert broadcast hardening", () => {
  beforeEach(() => {
    resetAdminAlertBroadcastState();
  });

  test("skips broadcast when subscriber count is 0", () => {
    expect(getAdminAlertSubscriberCount()).toBe(0);
    const result = tryBroadcastAdminAlert(
      alertKey({ type: "PROVIDER_OFFLINE", bookingId: "b1", providerId: "p1" }),
      { type: "PROVIDER_OFFLINE", message: "test" },
      Date.now(),
      0,
    );
    expect(result.action).toBe("skipped");
  });

  test("deduplicates identical alert keys", () => {
    const conn = {
      userId: "admin-1",
      userType: "admin" as const,
      connectionId: "conn_test_1",
      connectedAt: new Date(),
      lastPing: new Date(),
      rooms: new Set<string>(),
      send: () => {},
    };
    roomManager.addToRoom(ADMIN_OPS_ROOM, conn);

    const key = alertKey({ type: "ETA_BREACH", bookingId: "b2" });
    const first = tryBroadcastAdminAlert(key, { type: "ETA_BREACH", message: "slow" }, Date.now(), 0);
    const second = tryBroadcastAdminAlert(key, { type: "ETA_BREACH", message: "slow" }, Date.now(), 0);

    expect(first.action).toBe("sent");
    expect(second.action).toBe("deduplicated");

    roomManager.removeAllRooms(conn);
  });

  test("prevents duplicate room joins", () => {
    const conn = {
      userId: "admin-2",
      userType: "admin" as const,
      connectionId: "conn_test_2",
      connectedAt: new Date(),
      lastPing: new Date(),
      rooms: new Set<string>(),
      send: () => {},
    };
    roomManager.addToRoom(ADMIN_OPS_ROOM, conn);
    roomManager.addToRoom(ADMIN_OPS_ROOM, conn);
    expect(roomManager.getRoom(ADMIN_OPS_ROOM).size).toBe(1);
    roomManager.removeAllRooms(conn);
  });
});
