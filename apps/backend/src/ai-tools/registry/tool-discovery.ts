import type { AiGatewayRole } from "@prisma/client";
import type { AiIntent } from "../../ai/intent/intent-classifier";
import type { PartnerAiIntent } from "../../ai/intent/partner-intent";
import type { AdminAiIntent } from "../../ai/intent/admin-intent";
import type { ToolDefinition } from "../types";
import { listTools } from "./tool-registry";
import { getRoleToolPermissions } from "../policy/policy-rules";
import { recordToolDiscovery } from "../../lib/ai-tools-metrics";

/**
 * Which tools a model is even allowed to know about, for one turn.
 *
 * Exposure is a security boundary in its own right, separate from execution. A model that
 * can see `high_risk.finance.refund` will eventually propose it, and a user will see the
 * proposal and expect it to work — so refusing at execution time is too late to be the
 * only control. The rule here is simple: if the actor could not execute it in this
 * context, the model does not learn it exists.
 *
 * This narrows; it never widens. Everything surfaced here is still re-checked by the
 * policy engine and the handler at execution time.
 */

/**
 * Tool namespaces each intent legitimately needs.
 *
 * Keyed by intent so a customer asking about a booking is not handed booking-creation
 * tools, and a service search is not handed cancellation. `null` means "no tools" — the
 * right answer for a turn that has no business touching anything.
 */
const INTENT_TOOL_PREFIXES: Record<string, string[] | null> = {
  SERVICE_SEARCH: ["read.customer.getServices", "read.common", "read.customer.getOffers"],
  PRICING_INQUIRY: ["read.customer.getServices", "read.common", "read.customer.getOffers"],
  BOOKING_STATUS: ["read.customer.getBooking", "read.common.getLocation", "read.common.getETA"],
  CANCEL_RESCHEDULE: ["read.customer.getBooking", "write.booking.cancelBooking", "write.booking.rescheduleBooking"],
  COMPLAINT: ["read.customer.getBooking", "write.support.createSupportTicket"],
  ACCOUNT: ["read.customer.getWallet", "read.customer.getSubscription", "read.common.getNotifications"],
  GENERAL: ["read.customer.getServices"],
  EARNINGS: ["read.partner.getPartnerEarnings"],
  PAYOUT: ["read.partner.getPartnerPayout"],
  JOBS: ["read.partner.getPartnerJobs"],
  SCHEDULE: ["read.partner.getPartnerSchedule"],
  DEMAND: ["read.partner.getPartnerDemand"],
  PERFORMANCE: ["read.partner.getPartnerPerformance", "read.partner.getPerformanceNudges"],
  TRAINING: ["read.partner.getPartnerTraining"],
  ROUTE: ["read.partner.getPartnerJobs", "read.common.getETA"],
  CAREER: ["read.partner.getPartnerPerformance", "read.partner.getPartnerTraining"],
  MUTATION_REQUEST: null,
  DEMAND_SUPPLY: ["read.admin.getSupplyDemand", "read.admin.getDemand", "read.admin.getSupply", "read.admin.getForecast"],
  OPERATIONS: ["read.admin.getOperations", "read.admin.getSupplyDemand"],
  FINANCE_READ: ["read.admin.getFinanceSummary", "read.admin.getRevenue"],
};

/** Namespaces that are never discoverable, whatever the role or intent. */
const NEVER_DISCOVERABLE = ["high_risk."];

function matchesPermission(granted: string[], required: string): boolean {
  return granted.some((p) => (p.endsWith(".*") ? required.startsWith(p.slice(0, -1)) : p === required));
}

export type ToolDiscoveryInput = {
  actorRole: AiGatewayRole;
  intent?: AiIntent | PartnerAiIntent | AdminAiIntent | string;
  /** Set false to include write tools the caller has no confirmation flow for. */
  includeWrites?: boolean;
};

export type DiscoveredTool = Pick<
  ToolDefinition,
  "toolId" | "name" | "description" | "category" | "version" | "riskLevel" | "parameters"
>;

/**
 * Returns the tools this actor may see for this turn.
 *
 * Filters, in order: registered and active → not permanently hidden → role permitted →
 * intent relevant → writes only when the surface can carry a confirmation.
 */
export function getAvailableAiTools(input: ToolDiscoveryInput): DiscoveredTool[] {
  const permissions = getRoleToolPermissions(input.actorRole);
  const intentPrefixes = input.intent ? INTENT_TOOL_PREFIXES[input.intent] : undefined;

  const available = listTools({ status: "ACTIVE" }).filter((tool) => {
    // High-risk capabilities stay registered and policy-governed, but are never advertised
    // to a model. They move through an explicit human approval surface instead.
    if (NEVER_DISCOVERABLE.some((prefix) => tool.toolId.startsWith(prefix))) return false;

    if (!matchesPermission(permissions, tool.requiredPermission)) return false;

    if (tool.category === "WRITE" && input.includeWrites !== true) return false;

    // Partner GENERAL should see partner read tools, not the customer catalogue prefix.
    const effectivePrefixes =
      input.actorRole === "PARTNER" && (intentPrefixes === undefined || input.intent === "GENERAL")
        ? ["read.partner"]
        : input.actorRole === "ADMIN" && (intentPrefixes === undefined || input.intent === "GENERAL")
          ? ["read.admin"]
          : intentPrefixes;

    if (effectivePrefixes === undefined) return tool.category === "READ";
    if (effectivePrefixes === null) return false;

    return effectivePrefixes.some((prefix) => tool.toolId.startsWith(prefix));
  });

  recordToolDiscovery(input.actorRole, input.intent ?? "UNKNOWN", available.length);

  // Only the fields a model needs to choose and call a tool. Internal routing details —
  // service mapping, owner, cost, policy names — stay server-side.
  return available.map((tool) => ({
    toolId: tool.toolId,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    version: tool.version,
    riskLevel: tool.riskLevel,
    parameters: tool.parameters,
  }));
}

/**
 * JSON-Schema function definitions for an OpenAI-compatible provider.
 *
 * Built from the same filtered list, so a tool the model can call is by construction a
 * tool it was allowed to see.
 */
export function toProviderToolSchemas(tools: DiscoveredTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      properties[param.name] = { type: param.type, description: param.description };
      if (param.required) required.push(param.name);
    }

    return {
      type: "function",
      function: {
        name: tool.toolId.replace(/\./g, "__"),
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required,
          // A model must not be able to smuggle an argument the schema never declared.
          additionalProperties: false,
        },
      },
    };
  });
}

/** Reverses the provider-safe function name back to a registry tool id. */
export function fromProviderToolName(name: string): string {
  return name.replace(/__/g, ".");
}
