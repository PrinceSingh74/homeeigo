import { Elysia } from "elysia";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";
import { createAuthPlugin } from "../plugins/auth.plugin";
import { AuditLogService, requestMeta } from "../services/audit-log.service";
import { rbacService, type AdminRbacContext } from "../services/rbac.service";
import { incCounter } from "../lib/metrics";

export type { AdminRbacContext };

/** Scoped admin RBAC — extends authPlugin. Requires an active AdminUser row with role permissions. */
export function createAdminRbacPlugin(pluginName = "admin-rbac") {
  return new Elysia({ name: pluginName })
    .use(createAuthPlugin(`${pluginName}-auth`))
    .derive({ as: "scoped" }, async ({ authUser }) => {
      let adminContext: AdminRbacContext | null = null;
      if (authUser?.role === "ADMIN") {
        adminContext = await rbacService.resolveAdminContext(authUser.userId);
      }

      const requireAdminContext = (): AdminRbacContext => {
        if (!adminContext) {
          throw new Error("FORBIDDEN");
        }
        return adminContext;
      };

      return { adminContext, requireAdminContext };
    })
    // MUST be scoped: a local (default) hook would not run for the routes that
    // `.use()` this plugin, leaving every /api/admin route unauthenticated.
    .onBeforeHandle({ as: "scoped" }, async ({ request, set, requireRole, adminContext }) => {
      const pathname = new URL(request.url).pathname;
      const permission = resolveAdminRoutePermission(request.method, pathname);
      const isAdminApi = pathname.startsWith("/api/admin");
      const isScopedAdminRoute = permission !== null && !isAdminApi;
      if (!isAdminApi && !isScopedAdminRoute) return;

      // Fail CLOSED: if the auth context didn't provide requireRole, deny rather
      // than fall through unauthenticated (this is a security boundary).
      if (typeof requireRole !== "function") {
        set.status = 401;
        return { success: false, error: "Invalid or expired token", code: "UNAUTHORIZED" };
      }
      requireRole("ADMIN");

      if (!adminContext) {
        set.status = 403;
        incCounter("rbac_denied_total", { reason: "not_admin" });
        return {
          success: false,
          error: "Not an admin",
          code: "FORBIDDEN",
        };
      }

      if (!permission) {
        if (adminContext.role === "SUPER_ADMIN") {
          return;
        }
        set.status = 403;
        incCounter("rbac_denied_total", { reason: "unmapped_route" });
        void AuditLogService.record("ADMIN_ACCESS_DENIED", "failure", {
          userId: adminContext.userId,
          ...requestMeta(request),
          details: {
            adminId: adminContext.adminId,
            path: pathname,
            method: request.method,
            reason: "unmapped_route",
          },
        });
        return {
          success: false,
          error: "Permission denied",
          code: "FORBIDDEN",
        };
      }

      const allowed = await rbacService.hasPermission(
        adminContext,
        permission.resource,
        permission.action,
      );

      if (!allowed) {
        set.status = 403;
        incCounter("rbac_denied_total", { reason: "no_permission" });
        incCounter("suspicious_activity_total", { kind: "rbac_permission_violation" });
        void AuditLogService.record("ADMIN_ACCESS_DENIED", "failure", {
          userId: adminContext.userId,
          ...requestMeta(request),
          details: {
            adminId: adminContext.adminId,
            resource: permission.resource,
            attemptedAction: permission.action,
            path: pathname,
            method: request.method,
          },
        });
        return {
          success: false,
          error: "Permission denied",
          code: "FORBIDDEN",
        };
      }

      void rbacService.recordAdminAccess(
        adminContext,
        permission.resource,
        permission.action,
        { path: pathname, method: request.method },
        requestMeta(request),
      );
    });
}

export const adminRbacPlugin = createAdminRbacPlugin();
