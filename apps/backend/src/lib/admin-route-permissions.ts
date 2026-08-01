import type { AdminAction, AdminResource } from "@prisma/client";

export type AdminRoutePermission = {
  resource: AdminResource;
  action: AdminAction;
};

type RouteRule = {
  methods: string[];
  pattern: RegExp;
  resource: AdminResource;
  action: AdminAction;
};

const M = {
  GET: ["GET"],
  POST: ["POST"],
  PUT: ["PUT"],
  PATCH: ["PATCH"],
  DELETE: ["DELETE"],
  WRITE: ["POST", "PUT", "PATCH", "DELETE"],
  MUTATE: ["POST", "PUT", "PATCH"],
};

const rules: RouteRule[] = [
  // Dashboard & analytics
  { methods: M.GET, pattern: /^\/api\/admin\/dashboard$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/revenue-report$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/referrals\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/analytics/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/insights$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/queue\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/assignment\/metrics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/matching\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/campaigns\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/support\/analytics$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/hcoins\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/fraud\/analytics\/monthly$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/analytics\/unit-economics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/gmv$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/cx\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/growth\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/risk\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/platform\/intelligence$/, resource: "SETTINGS", action: "READ" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/platform\/flags$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/recovery\/status$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/recovery\/simulate$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/config/, resource: "PAYMENTS", action: "READ" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/finance\/config/, resource: "PAYMENTS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/health$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/email-health$/, resource: "ANALYTICS", action: "READ" },
  // Phase 16.4 / 17.4 — demand heatmap + live operations map.
  { methods: M.GET, pattern: /^\/api\/admin\/heatmap$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ops-map$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/workforce\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/documents\/pending$/, resource: "USERS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/providers\/[^/]+\/documents\/[^/]+\/verify$/, resource: "USERS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/academy\/modules$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/academy\/modules$/, resource: "SETTINGS", action: "CREATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/incentives\/rules$/, resource: "CAMPAIGNS", action: "READ" },

  // Users & providers
  { methods: M.GET, pattern: /^\/api\/admin\/users$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/account-deletions$/, resource: "USERS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/users\/[^/]+\/ban$/, resource: "USERS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/users\/[^/]+\/force-logout$/, resource: "USERS", action: "FORCE_LOGOUT" },
  { methods: M.PUT, pattern: /^\/api\/admin\/providers\/[^/]+\/verify$/, resource: "USERS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/users\/[^/]+\/blacklist$/, resource: "USERS", action: "UPDATE" },

  // Bookings
  { methods: M.GET, pattern: /^\/api\/admin\/bookings$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/events$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/cancel$/, resource: "BOOKINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/reschedule$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/reassign$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/dispatch$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/complete$/, resource: "BOOKINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/repair$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/refund$/, resource: "BOOKINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/refund\/retry$/, resource: "BOOKINGS", action: "APPROVE" },

  // Disputes / support / fraud
  { methods: M.GET, pattern: /^\/api\/admin\/support\/tickets$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/support\/tickets\/[^/]+$/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/respond$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/escalate$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/merge$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/resolve$/, resource: "DISPUTES", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/chargebacks$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/fraud\//, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/commissions\/[^/]+\/approve$/, resource: "DISPUTES", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/commissions\/[^/]+\/reject$/, resource: "DISPUTES", action: "REJECT" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/commissions\/[^/]+\/freeze$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/commissions\/[^/]+\/unfreeze$/, resource: "DISPUTES", action: "UPDATE" },

  // Payments & finance
  { methods: M.GET, pattern: /^\/api\/admin\/settlements$/, resource: "PAYMENTS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\//, resource: "PAYMENTS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\//, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/approve$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/reject$/, resource: "PAYMENTS", action: "REJECT" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/process$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/invoices/, resource: "PAYMENTS", action: "READ" },

  // Wallet / transfers / hcoins
  { methods: M.GET, pattern: /^\/api\/admin\/transfers$/, resource: "WALLET", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/hcoins\//, resource: "WALLET", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/hcoins\/rules\/[^/]+$/, resource: "WALLET", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/hcoins\/grant$/, resource: "WALLET", action: "UPDATE" },

  // Campaigns
  { methods: M.GET, pattern: /^\/api\/admin\/campaigns$/, resource: "CAMPAIGNS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/campaigns$/, resource: "CAMPAIGNS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/campaigns\/[^/]+$/, resource: "CAMPAIGNS", action: "UPDATE" },

  // Gift cards
  { methods: M.GET, pattern: /^\/api\/admin\/giftcards$/, resource: "GIFT_CARDS", action: "READ" },

  // Memberships & subscriptions
  { methods: M.GET, pattern: /^\/api\/admin\/subscriptions\//, resource: "MEMBERSHIPS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/subscriptions\//, resource: "MEMBERSHIPS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/subscriptions\//, resource: "MEMBERSHIPS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/cashback\//, resource: "MEMBERSHIPS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons$/, resource: "MEMBERSHIPS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/membership\/coupons$/, resource: "MEMBERSHIPS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/membership\/coupons\/[^/]+$/, resource: "MEMBERSHIPS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/membership\/coupons\/[^/]+\//, resource: "MEMBERSHIPS", action: "UPDATE" },

  // Settings (catalog / services)
  { methods: M.GET, pattern: /^\/api\/admin\/services$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/services$/, resource: "SETTINGS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.DELETE, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "DELETE" },
  { methods: M.POST, pattern: /^\/api\/admin\/observability\/alerts\//, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/observability\/validation\/run$/, resource: "SETTINGS", action: "UPDATE" },

  // Audit logs & exports
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/logs/, resource: "AUDIT_LOGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/audit-export\//, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/reports\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/analytics\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/invoices\/export\.csv$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/settlements\/[^/]+\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/evidence-certificate$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/evidence-package$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/evidence\/download\/[^/]+$/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/chargebacks\/evidence\/[^/]+\/download-token$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/chargebacks/, resource: "DISPUTES", action: "UPDATE" },

  // Admin user management
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/roles$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/admins$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/me$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/rbac\/grant-role$/, resource: "ADMIN_USERS", action: "CREATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/rbac\/revoke-role$/, resource: "ADMIN_USERS", action: "DELETE" },

  // Non-/api/admin scoped routes (P1 RBAC hardening)
  { methods: M.POST, pattern: /^\/api\/payments\/[^/]+\/refund$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/v1\/ws\/stats$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/compliance\/admin\/requests$/, resource: "USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/compliance\/admin\/requests\/[^/]+\/approve$/, resource: "DISPUTES", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/compliance\/admin\/requests\/[^/]+\/reject$/, resource: "DISPUTES", action: "REJECT" },
  { methods: M.GET, pattern: /^\/api\/compliance\/admin\/retention\/report$/, resource: "AUDIT_LOGS", action: "READ" },
];

/** First matching rule wins (order matters — specific paths before broad prefixes). */
export function resolveAdminRoutePermission(
  method: string,
  path: string,
): AdminRoutePermission | null {
  const normalizedPath = path.split("?")[0] ?? path;
  for (const rule of rules) {
    if (!rule.methods.includes(method)) continue;
    if (rule.pattern.test(normalizedPath)) {
      return { resource: rule.resource, action: rule.action };
    }
  }
  return null;
}
