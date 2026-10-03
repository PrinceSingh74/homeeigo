import type { AiGatewayRole } from "@prisma/client";

/** Platform finance/ops collectors are admin-scope. Partner/customer must never receive them. */
export function mayAttachPlatformFinance(role: AiGatewayRole): boolean {
  return role === "ADMIN" || role === "SYSTEM" || role === "AUTOMATION";
}
