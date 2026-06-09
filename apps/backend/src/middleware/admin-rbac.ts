import { Elysia } from "elysia";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";
import { authPlugin } from "../plugins/auth.plugin";
import { AuditLogService, requestMeta } from "../services/audit-log.service";
import { rbacService, type AdminRbacContext } from "../services/rbac.service";

export type { AdminRbacContext };

/**
 * Scoped admin RBAC — extends authPlugin.
 * Legacy `User.role === ADMIN` without an AdminUser row retains full access until bootstrapped.
 */
export const adminRbacPlugin = new Elysia({ name: "admin-rbac" })
  .use(authPlugin)
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
  .onBeforeHandle(async ({ path, request, set, requireRole, adminContext }) => {
    if (!path.startsWith("/api/admin")) return;

    requireRole("ADMIN");

    if (!adminContext) {
      set.status = 403;
      return {
        success: false,
        error: "Not an admin",
        code: "FORBIDDEN",
      };
    }

    const permission = resolveAdminRoutePermission(request.method, path);
    if (!permission) {
      if (adminContext.isLegacySuperAdmin || adminContext.role === "SUPER_ADMIN") {
        return;
      }
      set.status = 403;
      void AuditLogService.record("ADMIN_ACCESS_DENIED", "failure", {
        userId: adminContext.userId,
        ...requestMeta(request),
        details: {
          adminId: adminContext.adminId,
          path,
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
      void AuditLogService.record("ADMIN_ACCESS_DENIED", "failure", {
        userId: adminContext.userId,
        ...requestMeta(request),
        details: {
          adminId: adminContext.adminId,
          resource: permission.resource,
          attemptedAction: permission.action,
          path,
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
      { path, method: request.method },
      requestMeta(request),
    );
  });
