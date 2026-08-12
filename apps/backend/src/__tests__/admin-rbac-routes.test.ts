import { describe, expect, it } from "bun:test";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";

describe("resolveAdminRoutePermission", () => {
  it("maps user list to USERS.READ", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/users")).toEqual({
      resource: "USERS",
      action: "READ",
    });
  });

  it("maps finance dashboard to PAYMENTS.READ", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/finance/dashboard")).toEqual({
      resource: "PAYMENTS",
      action: "READ",
    });
  });

  it("maps withdrawal approve to PAYMENTS.APPROVE", () => {
    expect(resolveAdminRoutePermission("POST", "/api/admin/withdrawals/abc/approve")).toEqual({
      resource: "PAYMENTS",
      action: "APPROVE",
    });
  });

  it("maps grant-role to ADMIN_USERS.CREATE", () => {
    expect(resolveAdminRoutePermission("POST", "/api/admin/rbac/grant-role")).toEqual({
      resource: "ADMIN_USERS",
      action: "CREATE",
    });
  });

  it("returns null for unknown routes", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/unknown-route")).toBeNull();
  });

  it("maps scoped payment refund to PAYMENTS.APPROVE using full pathname", () => {
    expect(
      resolveAdminRoutePermission("POST", "/api/payments/pay_abc123/refund"),
    ).toEqual({
      resource: "PAYMENTS",
      action: "APPROVE",
    });
  });

  it("does not match plugin-relative refund paths", () => {
    expect(resolveAdminRoutePermission("POST", "/pay_abc123/refund")).toBeNull();
  });

  it("maps support ticket detail to DISPUTES.READ", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/support/tickets/t1")).toEqual({
      resource: "DISPUTES",
      action: "READ",
    });
  });

  it("maps support analytics to DISPUTES.READ (support-scoped)", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/support/analytics")).toEqual({
      resource: "DISPUTES",
      action: "READ",
    });
  });

  it("maps support escalate and merge to DISPUTES.UPDATE", () => {
    expect(resolveAdminRoutePermission("POST", "/api/admin/support/tickets/t1/escalate")).toEqual({
      resource: "DISPUTES",
      action: "UPDATE",
    });
    expect(resolveAdminRoutePermission("POST", "/api/admin/support/tickets/t1/merge")).toEqual({
      resource: "DISPUTES",
      action: "UPDATE",
    });
  });
});
