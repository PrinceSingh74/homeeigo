import type { AiGatewayRole } from "@prisma/client";
import type { AiAuthorizationResult } from "../types";

const ROLE_PERMISSIONS: Record<AiGatewayRole, string[]> = {
  CUSTOMER: ["customer.support.v1", "customer.*"],
  PARTNER: ["partner.ops.v1", "partner.*"],
  ADMIN: ["admin.*", "fraud.*", "finance.*", "operations.*", "analytics.*", "eta.*"],
  SUPPORT: ["support.*", "customer.support.v1"],
  SYSTEM: ["eta.*", "automation.*", "operations.*"],
  AUTOMATION: ["automation.*", "operations.*", "eta.*"],
};

const ENDPOINT_ROLE_MAP: Record<string, AiGatewayRole[]> = {
  customer: ["CUSTOMER"],
  partner: ["PARTNER"],
  admin: ["ADMIN"],
  chat: ["CUSTOMER", "ADMIN", "SUPPORT"],
};

export function authorizeAiRequest(
  actorRole: AiGatewayRole,
  endpoint: keyof typeof ENDPOINT_ROLE_MAP,
  templateId?: string,
): AiAuthorizationResult {
  const allowedRoles = ENDPOINT_ROLE_MAP[endpoint];
  if (!allowedRoles.includes(actorRole)) {
    return { allowed: false, reason: `role ${actorRole} not permitted on ${endpoint}` };
  }

  if (templateId) {
    const perms = ROLE_PERMISSIONS[actorRole] ?? [];
    const ok = perms.some((p) => {
      if (p.endsWith(".*")) {
        return templateId.startsWith(p.replace(".*", "."));
      }
      return p === templateId;
    });
    if (!ok) {
      return { allowed: false, reason: `template ${templateId} not permitted for ${actorRole}` };
    }
  }

  return { allowed: true };
}

export function getRolePermissions(actorRole: AiGatewayRole): string[] {
  return ROLE_PERMISSIONS[actorRole] ?? [];
}

export function mapUserRoleToAiRole(
  userRole: string,
  endpoint: keyof typeof ENDPOINT_ROLE_MAP,
): AiGatewayRole | null {
  if (endpoint === "customer" && userRole === "CUSTOMER") return "CUSTOMER";
  if (endpoint === "partner" && userRole === "VENDOR") return "PARTNER";
  if (endpoint === "admin" && userRole === "ADMIN") return "ADMIN";
  if (endpoint === "chat") {
    if (userRole === "CUSTOMER") return "CUSTOMER";
    if (userRole === "ADMIN") return "ADMIN";
    if (userRole === "VENDOR") return "PARTNER";
  }
  return null;
}
