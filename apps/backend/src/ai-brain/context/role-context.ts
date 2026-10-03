import type { AiGatewayRole } from "@prisma/client";
import { getRolePermissions } from "../../ai/security/authorization";
import { collectCustomerContext } from "./collectors/customer-context";
import { collectPartnerContext } from "./collectors/partner-context";
import { collectAdminContext } from "./collectors/admin-context";
import { collectSupportContext } from "./collectors/support-context";
import { collectFinanceContext } from "./collectors/finance-context";
import { collectOperationsContext } from "./collectors/operations-context";
import type { ContextBuildRequest, ContextSection } from "../types";
import { mayAttachPlatformFinance } from "./platform-scope";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function resolveRolePermissions(role: AiGatewayRole): Promise<string[]> {
  return getRolePermissions(role);
}

export async function buildBusinessObjectSection(
  role: AiGatewayRole,
  req: ContextBuildRequest,
): Promise<ContextSection | null> {
  const customerId = req.context?.customerId ?? req.context?.userId;
  let data: Record<string, unknown> = {};

  switch (role) {
    case "CUSTOMER":
      if (customerId) data = await collectCustomerContext(customerId);
      break;
    case "PARTNER":
      if (req.context?.partnerId) {
        const focus = String(req.context?.metadata?.intent ?? "GENERAL");
        data = await collectPartnerContext(req.context.partnerId, focus);
      }
      break;
    case "SUPPORT":
      data = await collectSupportContext(req.actorId);
      if (customerId) data.customerDetail = await collectCustomerContext(customerId);
      break;
    case "ADMIN":
      data = {
        platform: await collectAdminContext(),
        finance: await collectFinanceContext(),
        operations: await collectOperationsContext(),
      };
      if (customerId) data.customerDetail = await collectCustomerContext(customerId);
      if (req.context?.partnerId) data.partnerDetail = await collectPartnerContext(req.context.partnerId);
      break;
    case "SYSTEM":
    case "AUTOMATION":
      data = {
        operations: await collectOperationsContext(),
        finance: await collectFinanceContext(),
      };
      break;
    default:
      break;
  }

  // Platform finance/ops context is admin-only. A partner earnings question must never
  // pull ledger, payout batches, or fraud narratives.
  if (mayAttachPlatformFinance(role) && (req.intent === "finance" || req.context?.metadata?.domain === "finance")) {
    data.finance = await collectFinanceContext();
  }
  if (mayAttachPlatformFinance(role) && (req.intent === "operations" || req.context?.metadata?.domain === "operations")) {
    data.operations = await collectOperationsContext();
  }

  if (Object.keys(data).length === 0) return null;
  const content = `Business Context:\n${JSON.stringify(data, null, 2)}`;
  return { name: "business_objects", content, priority: 80, tokenEstimate: estimateTokens(content) };
}

export async function buildPermissionsSection(role: AiGatewayRole): Promise<ContextSection> {
  const permissions = await resolveRolePermissions(role);
  const content = `Permissions: ${permissions.join(", ")}`;
  return { name: "permissions", content, priority: 95, tokenEstimate: estimateTokens(content) };
}
