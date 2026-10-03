import { describe, expect, it } from "bun:test";
import { adminApiRoutes } from "../routes/admin";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";

/**
 * Every route registered under /api/admin must resolve to an RBAC rule.
 *
 * The middleware treats an unmapped route as SUPER_ADMIN-only (middleware/admin-rbac.ts). That is
 * a safe default for the platform and a broken product for every other admin role: the console
 * showed them the button and the backend answered 403 `unmapped_route`. Ten such routes shipped
 * before this test existed. New admin routes now fail CI until they carry a rule — or are listed
 * below with a reason.
 */
const INTENTIONALLY_SUPER_ADMIN_ONLY: Array<{ method: string; path: string; reason: string }> = [
  // none yet — add {method, path, reason} entries deliberately, never to silence the test
];

function sampleParams(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, "sample");
}

describe("admin route RBAC coverage", () => {
  it("resolves a permission for every /api/admin route", () => {
    const routes = (adminApiRoutes as unknown as { routes: Array<{ method: string; path: string }> }).routes;
    expect(routes.length).toBeGreaterThan(200);

    const unmapped: string[] = [];
    for (const r of routes) {
      if (!r.path.startsWith("/api/admin")) continue;
      const method = r.method.toUpperCase();
      if (method === "OPTIONS" || method === "HEAD") continue;
      const allowed = INTENTIONALLY_SUPER_ADMIN_ONLY.some((a) => a.method === method && a.path === r.path);
      if (allowed) continue;
      const permission = resolveAdminRoutePermission(method, sampleParams(r.path));
      if (!permission) unmapped.push(`${method} ${r.path}`);
    }

    expect(unmapped).toEqual([]);
  });

  it("maps the previously unmapped console routes to their neighbours' resources", () => {
    expect(resolveAdminRoutePermission("GET", "/api/admin/reviews")).toEqual({ resource: "DISPUTES", action: "READ" });
    expect(resolveAdminRoutePermission("PATCH", "/api/admin/reviews/r1")).toEqual({ resource: "DISPUTES", action: "UPDATE" });
    expect(resolveAdminRoutePermission("DELETE", "/api/admin/reviews/r1")).toEqual({ resource: "DISPUTES", action: "DELETE" });
    expect(resolveAdminRoutePermission("PATCH", "/api/admin/services/s1/status")).toEqual({ resource: "SETTINGS", action: "UPDATE" });
    expect(resolveAdminRoutePermission("POST", "/api/admin/membership/coupons/bulk")).toEqual({ resource: "MEMBERSHIPS", action: "CREATE" });
    expect(resolveAdminRoutePermission("PUT", "/api/admin/hcoins/expiry/config")).toEqual({ resource: "WALLET", action: "UPDATE" });
    expect(resolveAdminRoutePermission("POST", "/api/admin/hcoins/expiry/run")).toEqual({ resource: "WALLET", action: "UPDATE" });
    expect(resolveAdminRoutePermission("GET", "/api/admin/observability/alerts")).toEqual({ resource: "ANALYTICS", action: "READ" });
    expect(resolveAdminRoutePermission("GET", "/api/admin/partner-availability")).toEqual({ resource: "ANALYTICS", action: "READ" });
    // reject mirrors verify — and matches what the handler itself enforces.
    expect(resolveAdminRoutePermission("PUT", "/api/admin/providers/p1/documents/d1/reject")).toEqual(
      resolveAdminRoutePermission("PUT", "/api/admin/providers/p1/documents/d1/verify"),
    );
  });
});
