import type { AdminAction, AdminResource, AdminRoleType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

export type AdminRbacContext = {
  adminId: string;
  userId: string;
  role: AdminRoleType;
};

type PermissionSeed = {
  resource: AdminResource;
  action: AdminAction;
};

const DEFAULT_ROLES: Array<{
  name: AdminRoleType;
  description: string;
  permissions: PermissionSeed[];
}> = [
  {
    name: "SUPER_ADMIN",
    description: "Full system access",
    permissions: [],
  },
  {
    name: "FINANCE_ADMIN",
    description: "Wallet, payments, payouts, settlements",
    permissions: [
      { resource: "PAYMENTS", action: "READ" },
      { resource: "PAYMENTS", action: "UPDATE" },
      { resource: "PAYMENTS", action: "APPROVE" },
      { resource: "PAYMENTS", action: "REJECT" },
      { resource: "PAYMENTS", action: "EXPORT" },
      { resource: "WALLET", action: "READ" },
      { resource: "WALLET", action: "UPDATE" },
      { resource: "ANALYTICS", action: "READ" },
      { resource: "AUDIT_LOGS", action: "READ" },
    ],
  },
  {
    name: "OPERATIONS_ADMIN",
    description: "Bookings, disputes, users",
    permissions: [
      { resource: "BOOKINGS", action: "READ" },
      { resource: "BOOKINGS", action: "UPDATE" },
      { resource: "BOOKINGS", action: "APPROVE" },
      { resource: "DISPUTES", action: "READ" },
      { resource: "DISPUTES", action: "APPROVE" },
      { resource: "DISPUTES", action: "UPDATE" },
      { resource: "USERS", action: "READ" },
      { resource: "USERS", action: "UPDATE" },
    ],
  },
  {
    name: "SUPPORT_ADMIN",
    description: "Customer support operations",
    permissions: [
      { resource: "USERS", action: "READ" },
      { resource: "BOOKINGS", action: "READ" },
      { resource: "DISPUTES", action: "READ" },
      { resource: "DISPUTES", action: "UPDATE" },
      { resource: "DISPUTES", action: "APPROVE" },
      { resource: "USERS", action: "FORCE_LOGOUT" },
    ],
  },
  {
    name: "MARKETING_ADMIN",
    description: "Campaigns, gift cards, memberships",
    permissions: [
      { resource: "CAMPAIGNS", action: "CREATE" },
      { resource: "CAMPAIGNS", action: "READ" },
      { resource: "CAMPAIGNS", action: "UPDATE" },
      { resource: "GIFT_CARDS", action: "CREATE" },
      { resource: "GIFT_CARDS", action: "READ" },
      { resource: "MEMBERSHIPS", action: "READ" },
      { resource: "MEMBERSHIPS", action: "UPDATE" },
      { resource: "ANALYTICS", action: "READ" },
    ],
  },
  {
    name: "ANALYTICS_ADMIN",
    description: "Analytics and reporting only",
    permissions: [
      { resource: "ANALYTICS", action: "READ" },
      { resource: "ANALYTICS", action: "EXPORT" },
      { resource: "AUDIT_LOGS", action: "READ" },
    ],
  },
];

class RBACService {
  private readonly permissionCache = new Map<string, Set<string>>();

  async resolveAdminContext(userId: string): Promise<AdminRbacContext | null> {
    const adminUser = await prisma.adminUser.findUnique({
      where: { userId },
      include: { role: true },
    });

    if (adminUser) {
      if (!adminUser.isActive) {
        return null;
      }
      return {
        adminId: adminUser.id,
        userId,
        role: adminUser.role.name,
      };
    }

    return null;
  }

  async hasPermission(
    admin: AdminRbacContext,
    resource: AdminResource,
    action: AdminAction,
  ): Promise<boolean> {
    try {
      if (admin.role === "SUPER_ADMIN") {
        return true;
      }

      const adminUser = await prisma.adminUser.findUnique({
        where: { id: admin.adminId },
        include: {
          role: {
            include: { permissions: true },
          },
        },
      });

      if (!adminUser || !adminUser.isActive) {
        return false;
      }

      return adminUser.role.permissions.some(
        (permission) => permission.resource === resource && permission.action === action,
      );
    } catch (err) {
      console.error("RBAC check failed:", err);
      return false;
    }
  }

  async enforcePermission(
    admin: AdminRbacContext,
    resource: AdminResource,
    action: AdminAction,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const allowed = await this.hasPermission(admin, resource, action);
    if (allowed) return;

    void AuditLogService.record("ADMIN_ACCESS_DENIED", "failure", {
      userId: admin.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      details: {
        adminId: admin.adminId,
        resource,
        attemptedAction: action,
      },
    });

    throw new Error(`Permission denied: ${resource}.${action}`);
  }

  async getPermissions(adminId: string): Promise<Set<string>> {
    const cached = this.permissionCache.get(adminId);
    if (cached) return cached;

    try {
      const adminUser = await prisma.adminUser.findUnique({
        where: { id: adminId },
        include: {
          role: {
            include: { permissions: true },
          },
        },
      });

      if (!adminUser) {
        return new Set();
      }

      const permissions = new Set<string>();
      if (adminUser.role.name === "SUPER_ADMIN") {
        permissions.add("*");
      } else {
        for (const permission of adminUser.role.permissions) {
          permissions.add(`${permission.resource}:${permission.action}`);
        }
      }

      this.permissionCache.set(adminId, permissions);
      setTimeout(() => this.permissionCache.delete(adminId), 5 * 60 * 1000);
      return permissions;
    } catch (err) {
      console.error("Failed to get permissions:", err);
      return new Set();
    }
  }

  async grantRole(grantedBy: AdminRbacContext, userId: string, roleId: string): Promise<void> {
    await this.enforcePermission(grantedBy, "ADMIN_USERS", "CREATE");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    const role = await prisma.adminRole.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new Error("Role not found");
    }

    await prisma.adminUser.deleteMany({ where: { userId } });

    const adminUser = await prisma.adminUser.create({
      data: {
        userId,
        roleId,
        grantedBy: grantedBy.adminId,
      },
    });

    if (user.role !== "ADMIN") {
      await prisma.user.update({
        where: { id: userId },
        data: { role: "ADMIN" },
      });
    }

    this.permissionCache.delete(adminUser.id);

    void AuditLogService.record("ADMIN_PERMISSION_GRANTED", "success", {
      userId: grantedBy.userId,
      details: {
        targetUserId: userId,
        roleId,
        adminUserId: adminUser.id,
        roleName: role.name,
      },
    });
  }

  async revokeRole(revokedBy: AdminRbacContext, adminUserId: string): Promise<void> {
    await this.enforcePermission(revokedBy, "ADMIN_USERS", "DELETE");

    const adminUser = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new Error("Admin user not found");
    }

    if (adminUser.id === revokedBy.adminId) {
      throw new Error("Cannot revoke your own admin access");
    }

    await prisma.adminUser.update({
      where: { id: adminUserId },
      data: {
        isActive: false,
        revokedBy: revokedBy.adminId,
        revokedAt: new Date(),
      },
    });

    this.permissionCache.delete(adminUserId);

    void AuditLogService.record("ADMIN_PERMISSION_REVOKED", "success", {
      userId: revokedBy.userId,
      details: {
        targetUserId: adminUser.userId,
        adminUserId,
      },
    });
  }

  async listRoles() {
    return prisma.adminRole.findMany({
      include: {
        permissions: true,
        _count: { select: { adminUsers: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async listAdminUsers() {
    return prisma.adminUser.findMany({
      where: { isActive: true },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { grantedAt: "desc" },
    });
  }

  async recordAdminAccess(
    admin: AdminRbacContext,
    resource: AdminResource,
    action: AdminAction,
    details?: Record<string, unknown>,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const mutating: AdminAction[] = [
      "CREATE",
      "UPDATE",
      "DELETE",
      "APPROVE",
      "REJECT",
      "EXPORT",
      "FORCE_LOGOUT",
      "IMPERSONATE",
    ];
    if (!mutating.includes(action)) return;

    void AuditLogService.record("ADMIN_ACTION", "success", {
      userId: admin.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      details: {
        adminId: admin.adminId,
        role: admin.role,
        resource,
        action,
        ...(details ?? {}),
      },
    });
  }

  async initializeDefaultRoles(): Promise<void> {
    for (const roleData of DEFAULT_ROLES) {
      const existing = await prisma.adminRole.findUnique({
        where: { name: roleData.name },
      });
      if (existing) continue;

      const role = await prisma.adminRole.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          createdBy: "SYSTEM",
        },
      });

      for (const permission of roleData.permissions) {
        await prisma.adminPermission.create({
          data: {
            roleId: role.id,
            resource: permission.resource,
            action: permission.action,
          },
        });
      }
    }
  }

  /** Ensures seeded permissions exist on roles created before permission updates. */
  async syncDefaultRolePermissions(): Promise<void> {
    for (const roleData of DEFAULT_ROLES) {
      if (roleData.name === "SUPER_ADMIN" || roleData.permissions.length === 0) continue;
      const role = await prisma.adminRole.findUnique({ where: { name: roleData.name } });
      if (!role) continue;
      for (const permission of roleData.permissions) {
        await prisma.adminPermission.upsert({
          where: {
            roleId_resource_action: {
              roleId: role.id,
              resource: permission.resource,
              action: permission.action,
            },
          },
          create: {
            roleId: role.id,
            resource: permission.resource,
            action: permission.action,
          },
          update: {},
        });
      }
    }
  }

  async bootstrap(): Promise<void> {
    await this.initializeDefaultRoles();
    await this.syncDefaultRolePermissions();
  }
}

export const rbacService = new RBACService();
