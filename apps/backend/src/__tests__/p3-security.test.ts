import { describe, expect, it } from "bun:test";
import { calculateGiftCardBlockDurationMinutes } from "../services/gift-card-protection.service";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";
import { mapUserRoleToWsType } from "../lib/ws-channel-access";

describe("P3 Enterprise Hardening — unit tests", () => {
  describe("Gift card brute-force protection", () => {
    it("applies progressive lockout after threshold", () => {
      expect(calculateGiftCardBlockDurationMinutes(5)).toBe(30);
      expect(calculateGiftCardBlockDurationMinutes(6)).toBe(45);
      expect(calculateGiftCardBlockDurationMinutes(7)).toBeGreaterThan(45);
    });
  });

  describe("Admin RBAC route map", () => {
    it("maps force-logout to USERS.FORCE_LOGOUT", () => {
      expect(resolveAdminRoutePermission("POST", "/api/admin/users/u1/force-logout")).toEqual({
        resource: "USERS",
        action: "FORCE_LOGOUT",
      });
    });

    it("maps gift card admin list to GIFT_CARDS.READ", () => {
      expect(resolveAdminRoutePermission("GET", "/api/admin/giftcards")).toEqual({
        resource: "GIFT_CARDS",
        action: "READ",
      });
    });
  });

  describe("WebSocket role mapping", () => {
    it("maps DB roles to WS channel types", () => {
      expect(mapUserRoleToWsType("CUSTOMER")).toBe("customer");
      expect(mapUserRoleToWsType("VENDOR")).toBe("vendor");
      expect(mapUserRoleToWsType("ADMIN")).toBe("admin");
    });
  });
});
