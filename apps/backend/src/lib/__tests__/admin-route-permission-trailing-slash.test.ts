/**
 * A trailing slash must not change which admin permission a request is checked against (2026-10-01).
 */
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { resolveAdminRoutePermission } from "../admin-route-permissions";

describe("admin route permissions and trailing slashes", () => {
  it("precondition: Elysia serves '/x/' from the '/x' handler, so the slash form is reachable", async () => {
    const app = new Elysia().post("/api/compliance/admin/requests/:id/approve", () => "approved");
    const res = await app.handle(new Request("http://localhost/api/compliance/admin/requests/r1/approve/", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("approved");
  });

  it.each([
    ["GET", "/api/admin/finance/chargebacks/cb1/export", { resource: "AUDIT_LOGS", action: "EXPORT" }],
    ["POST", "/api/admin/finance/refunds/rf1/reject", { resource: "PAYMENTS", action: "REJECT" }],
    ["POST", "/api/compliance/admin/requests/r1/approve", { resource: "DISPUTES", action: "APPROVE" }],
  ] as const)("%s %s resolves the same with or without a trailing slash", (method, path, expected) => {
    expect(resolveAdminRoutePermission(method, path)).toEqual(expected);
    expect(resolveAdminRoutePermission(method, `${path}/`)).toEqual(expected);
    expect(resolveAdminRoutePermission(method, `${path}//`)).toEqual(expected);
    expect(resolveAdminRoutePermission(method, `${path}/?a=1`)).toEqual(expected);
  });
});
