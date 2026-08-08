import type { AiGatewayRole } from "@prisma/client";
import type { PolicyEvaluationInput, PolicyEvaluationResult } from "../types";

export type PolicyRule = {
  id: string;
  description: string;
  evaluate: (input: PolicyEvaluationInput) => PolicyEvaluationResult | null;
};

const ROLE_TOOL_PERMISSIONS: Record<AiGatewayRole, string[]> = {
  CUSTOMER: ["tools.read.customer.*", "tools.read.common.*", "tools.write.customer.*", "tools.write.common.support"],
  PARTNER: ["tools.read.partner.*", "tools.read.common.*", "tools.write.partner.*", "tools.write.common.support"],
  ADMIN: ["tools.read.admin.*", "tools.read.common.*", "tools.write.admin.*", "tools.write.common.*", "tools.high_risk.*"],
  SUPPORT: ["tools.read.common.*", "tools.write.admin.support", "tools.write.common.support"],
  SYSTEM: ["tools.read.*", "tools.write.*"],
  AUTOMATION: ["tools.read.*", "tools.write.*"],
};

function matchesPermission(granted: string[], required: string): boolean {
  return granted.some((p) => {
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -1);
      return required.startsWith(prefix);
    }
    return p === required;
  });
}

function roleAllowed(requiredRole: string, actorRole: AiGatewayRole): boolean {
  const roles = requiredRole.split(",").map((r) => r.trim());
  return roles.includes(actorRole);
}

export const POLICY_RULES: PolicyRule[] = [
  {
    id: "maintenance.write_block",
    description: "Block write tools during maintenance mode",
    evaluate: (input) => {
      if (process.env.MAINTENANCE_MODE === "true" && input.tool.category === "WRITE") {
        return { decision: "DENY", reason: "Maintenance mode active — write tools disabled", ruleMatched: "maintenance.write_block" };
      }
      return null;
    },
  },
  {
    id: "high_risk.approval_required",
    description: "High risk tools always require human approval",
    evaluate: (input) => {
      if (input.tool.category === "HIGH_RISK" || input.tool.approvalRequired) {
        return {
          decision: "REQUIRES_APPROVAL",
          reason: "High-risk action requires human approval",
          ruleMatched: "high_risk.approval_required",
          riskScore: input.tool.riskLevel === "CRITICAL" ? 1.0 : 0.8,
        };
      }
      return null;
    },
  },
  {
    id: "rbac.role_check",
    description: "Verify actor role matches tool requirement",
    evaluate: (input) => {
      if (!roleAllowed(input.tool.requiredRole, input.actor.actorRole)) {
        return { decision: "DENY", reason: `Role ${input.actor.actorRole} not permitted`, ruleMatched: "rbac.role_check" };
      }
      return null;
    },
  },
  {
    id: "rbac.permission_check",
    description: "Verify actor has tool permission namespace",
    evaluate: (input) => {
      const perms = ROLE_TOOL_PERMISSIONS[input.actor.actorRole] ?? [];
      if (!matchesPermission(perms, input.tool.requiredPermission)) {
        return { decision: "DENY", reason: `Missing permission ${input.tool.requiredPermission}`, ruleMatched: "rbac.permission_check" };
      }
      return null;
    },
  },
  {
    id: "customer.ownership",
    description: "Customer must own the booking resource",
    evaluate: (input) => {
      if (input.tool.requiredPolicy !== "customer.ownership") return null;
      const bookingId = input.arguments.bookingId as string | undefined;
      if (!bookingId) {
        return { decision: "DENY", reason: "bookingId required for ownership check", ruleMatched: "customer.ownership" };
      }
      return null;
    },
  },
  {
    id: "pii.rate_limit",
    description: "Rate limit sensitive admin finance reads",
    evaluate: (input) => {
      if (input.tool.requiredPolicy === "admin.finance.read" && input.actor.actorRole === "ADMIN") {
        return null;
      }
      return null;
    },
  },
  {
    id: "fraud.block_high_risk_actor",
    description: "Block tools for flagged actors",
    evaluate: (input) => {
      if (process.env.AI_TOOL_FRAUD_BLOCK === input.actor.actorId) {
        return { decision: "DENY", reason: "Actor flagged by fraud policy", ruleMatched: "fraud.block_high_risk_actor" };
      }
      return null;
    },
  },
  {
    id: "time.business_hours",
    description: "Restrict high-value writes outside business hours (IST)",
    evaluate: (input) => {
      if (input.tool.category !== "WRITE" || input.tool.riskLevel !== "MEDIUM") return null;
      const enforce = process.env.AI_TOOL_BUSINESS_HOURS_ONLY === "true";
      if (!enforce) return null;
      const hour = new Date().getUTCHours() + 5.5;
      const istHour = hour >= 24 ? hour - 24 : hour;
      if (istHour < 6 || istHour >= 23) {
        return { decision: "DENY", reason: "Write tools restricted outside business hours (6:00–23:00 IST)", ruleMatched: "time.business_hours" };
      }
      return null;
    },
  },
  {
    id: "default.allow",
    description: "Allow if all prior rules pass",
    evaluate: () => ({ decision: "ALLOW", ruleMatched: "default.allow" }),
  },
];

export function getRoleToolPermissions(role: AiGatewayRole): string[] {
  return ROLE_TOOL_PERMISSIONS[role] ?? [];
}
