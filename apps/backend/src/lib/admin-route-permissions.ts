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
  { methods: M.GET, pattern: /^\/api\/admin\/command-center\/overview$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/revenue-report$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/referrals\/analytics$/, resource: "ANALYTICS", action: "READ" },
  // Export precedes the analytics prefix rule that would otherwise swallow it.
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/analytics\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/analytics/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/insights$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/queue\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/assignment\/metrics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/matching\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/campaigns\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/support\/intelligence\/analytics$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/support\/analytics$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/hcoins\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/fraud\/analytics\/monthly$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/analytics\/unit-economics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/gmv$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/cx\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/growth\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/risk\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  /**
   * Phase-9 executive intelligence (Capability 12).
   *
   * `ANALYTICS`/`READ` is quoted from the four intelligence rules directly above, not chosen:
   * the brief composes exactly those sources, so it must not be reachable by anyone who could not
   * have opened them individually. Placed here, among the specific rules, because
   * `resolveAdminRoutePermission` returns the FIRST match — the five dead `AUDIT_LOGS`/`EXPORT`
   * rules further down are dead precisely because a broad prefix rule sits above them.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/intelligence\/executive-brief$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/intelligence\/report-schedule$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/intelligence\/report-recipients$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/platform\/intelligence$/, resource: "SETTINGS", action: "READ" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/platform\/flags$/, resource: "SETTINGS", action: "UPDATE" },
  /**
   * Phase-11 knowledge base. `SETTINGS` is quoted from the platform-configuration rules above:
   * official knowledge is platform configuration, not a customer record. Approval takes APPROVE so
   * it cannot be performed by a role that may only edit settings.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/knowledge\/documents$/, resource: "SETTINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/knowledge\/analytics$/, resource: "SETTINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/knowledge\/evaluation$/, resource: "SETTINGS", action: "READ" },


  /**
   * Phase 12 — ML governance.
   *
   * Reads are ANALYTICS: a readiness report or a holdout evaluation is a measurement, and the people
   * who need to look at model quality are the same ones who read every other analytic.
   *
   * Writes split on what they actually decide. Registering a candidate or moving it between
   * pre-approval stages is SETTINGS/UPDATE — it changes configuration and nothing serves differently.
   * Approving, promoting and rolling back change which model the platform predicts with, so they
   * take SETTINGS/APPROVE, the same strength as declaring knowledge precedence.
   *
   * The `/versions/:id` rules sit above `/models/:name/...` deliberately: both would match a
   * two-segment path, and a reader of one must not inherit the permission of the other.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/ml\/(health|readiness|models)$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ml\/demand\/(evaluation|forecast)$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ml\/shadow\/[^/]+$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ml\/models\/[^/]+\/versions$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/ml\/versions\/[^/]+\/approve$/, resource: "SETTINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/ml\/versions\/[^/]+\/promote$/, resource: "SETTINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/ml\/models\/[^/]+\/rollback$/, resource: "SETTINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/ml\/versions\/[^/]+\/transition$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/ml\/models\/[^/]+\/versions$/, resource: "SETTINGS", action: "UPDATE" },

  /**
   * Phase 14 — governance controls.
   *
   * Reading a cap or a stuck-instance list is ANALYTICS/READ. Setting a spend limit and moving a
   * workflow instance's state are both SETTINGS/UPDATE: each changes what the platform does next,
   * and neither should be reachable by an admin who can only read reports.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/governance\/ai-budgets$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/governance\/ai-budgets$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/governance\/workflows\/stuck$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/governance\/workflows\/[^/]+\/recover$/, resource: "SETTINGS", action: "UPDATE" },

  /**
   * Phase 15 — AI-assisted workflow drafting.
   *
   * Creating a draft is SETTINGS/UPDATE rather than a read: it stores machine-generated content
   * under an admin identity. Reviewing one is SETTINGS/APPROVE, matching model promotion —
   * approving automation somebody else will implement is an approval, not an edit.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/governance\/workflow-drafts$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/governance\/workflow-drafts$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/governance\/workflow-drafts\/[^/]+\/review$/, resource: "SETTINGS", action: "APPROVE" },

  /**
   * Phase 15 — offline model evaluations. Read-only: they train on a temporal split and report
   * metrics. Nothing serves, and neither registers a version in the ML registry.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/governance\/models\/cancellation-risk\/evaluation$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/governance\/models\/provider-acceptance\/evaluation$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/documents\/[^/]+\/approve$/, resource: "SETTINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/documents\/[^/]+\/withdraw$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/documents\/[^/]+\/reindex$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/seed$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/ask$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/retrieve$/, resource: "SETTINGS", action: "READ" },
  /**
   * Authoring takes UPDATE, not APPROVE.
   *
   * Creating a document and submitting it for review changes nothing a user can be answered from —
   * both land short of APPROVED. Splitting them this way is what makes review meaningful: an
   * operator who may author cannot also be the one who makes their own text authoritative.
   */
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/documents$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/documents\/[^/]+\/submit-review$/, resource: "SETTINGS", action: "UPDATE" },
  /**
   * Declaring precedence takes APPROVE, the same action as approving a document.
   *
   * It is the stronger of the two acts: approving makes one document answerable, declaring authority
   * decides which of two approved documents governs every future answer. Anything weaker would let a
   * settings-level operator override the effect of an approval they were not entitled to make.
   *
   * This rule sits ABOVE the parameterised document rules only in file order, which does not matter
   * here — the paths are disjoint. It sits below nothing that would shadow it, and
   * `admin-route-permissions` resolves first-match, so that is asserted in the test rather than
   * assumed.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/knowledge\/authority$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/knowledge\/authority$/, resource: "SETTINGS", action: "APPROVE" },
  { methods: M.DELETE, pattern: /^\/api\/admin\/knowledge\/authority\/[^/]+$/, resource: "SETTINGS", action: "APPROVE" },
  /**
   * The single-document read is last among the knowledge GETs on purpose: its `[^/]+` segment would
   * otherwise shadow `/knowledge/authority` and `/knowledge/analytics`, handing a reader of one
   * document the permission intended for the other routes. First-match ordering makes placement a
   * correctness property, not a style choice.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/knowledge\/documents\/[^/]+$/, resource: "SETTINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/recovery\/status$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/recovery\/simulate$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/config/, resource: "PAYMENTS", action: "READ" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/finance\/config/, resource: "PAYMENTS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/health$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/automation/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/automation\/dead-letters\/[^/]+\/replay$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/email-health$/, resource: "ANALYTICS", action: "READ" },
  // Phase 16.4 / 17.4 — demand heatmap + live operations map.
  { methods: M.GET, pattern: /^\/api\/admin\/heatmap$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ops-map$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/ops-alerts\/acks$/, resource: "ANALYTICS", action: "READ" },
  // Money-bearing consistency findings: finance-grade read.
  { methods: M.GET, pattern: /^\/api\/admin\/integrity\/booking-consistency$/, resource: "PAYMENTS", action: "READ" },
  // Acknowledging silences an alert for every admin — an operational act, not a read.
  { methods: M.POST, pattern: /^\/api\/admin\/ops-alerts\/acks$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/workforce\/analytics$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/partner-acquisition/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/partner-acquisition/, resource: "USERS", action: "CREATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/partner-acquisition/, resource: "USERS", action: "UPDATE" },
  { methods: M.DELETE, pattern: /^\/api\/admin\/partner-acquisition/, resource: "USERS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/partner-referrals/, resource: "ANALYTICS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/partner-referrals/, resource: "USERS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+\/intelligence$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/documents\/pending$/, resource: "USERS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/providers\/[^/]+\/documents\/[^/]+\/verify$/, resource: "USERS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/academy\/modules$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/academy\/modules$/, resource: "SETTINGS", action: "CREATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/academy\/modules\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/incentives\/rules$/, resource: "CAMPAIGNS", action: "READ" },

  // Users & providers
  { methods: M.GET, pattern: /^\/api\/admin\/users$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+\/(score|career|lifecycle)(\/history)?$/, resource: "USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/providers\/[^/]+\/lifecycle$/, resource: "USERS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/account-deletions$/, resource: "USERS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/users\/[^/]+\/ban$/, resource: "USERS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/users\/[^/]+\/force-logout$/, resource: "USERS", action: "FORCE_LOGOUT" },
  // Phase D — support sets/corrects a customer's date of birth (with reason); age-policy decision log (no DOB).
  { methods: M.PUT, pattern: /^\/api\/admin\/users\/[^/]+\/date-of-birth$/, resource: "USERS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/customer-policy\/decisions$/, resource: "USERS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/providers\/[^/]+\/verify$/, resource: "USERS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/fraud\/users\/[^/]+\/blacklist$/, resource: "USERS", action: "UPDATE" },
  /**
   * Phase 11 — provider capability (routes/admin-capabilities.ts). Provider records are USERS, as
   * above: review is READ, fact corrections UPDATE, verification / service-capability / membership
   * decisions APPROVE. The skills catalogue and service → business ownership are catalogue
   * configuration, so they take SETTINGS like /admin/services.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+\/capabilities$/, resource: "USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/providers\/[^/]+\/capabilities\/[^/]+\/[^/]+\/(verify|reject|revoke)$/, resource: "USERS", action: "APPROVE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/providers\/[^/]+\/capabilities\/[^/]+\/[^/]+$/, resource: "USERS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/providers\/[^/]+\/services\/[^/]+\/(approve|suspend|revoke)$/, resource: "USERS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/providers\/[^/]+\/service-skills$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/service-skill-requests$/, resource: "USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/businesses(\/[^/]+)?$/, resource: "USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/businesses$/, resource: "USERS", action: "UPDATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/businesses\/[^/]+$/, resource: "USERS", action: "UPDATE" },
  { methods: ["POST", "DELETE"], pattern: /^\/api\/admin\/businesses\/[^/]+\/providers\/[^/]+$/, resource: "USERS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/skills$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/skills$/, resource: "SETTINGS", action: "CREATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/skills\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/services\/[^/]+\/business$/, resource: "SETTINGS", action: "UPDATE" },

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
  // §52/§53: support overriding the evidence gate the partner and customer are bound by.
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/no-show$/, resource: "BOOKINGS", action: "APPROVE" },
  // Phase 10 §6 — requirement operations view + the one admin action (force a re-check, with reason).
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/requirements$/, resource: "BOOKINGS", action: "READ" },
  // Phase 10 §9 — safety operations: view, and the one admin action (release a hold, with reason).
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/safety$/, resource: "BOOKINGS", action: "READ" },
  /**
   * Phase 10 §11 — complaint / warranty-claim cases. DISPUTES, quoted from the support-ticket rules:
   * a case is a dispute about finished work. Working a case is UPDATE; deciding it (resolve: it can
   * move money and create a booking) is APPROVE, the strength ticket resolution takes.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/cases$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/cases\/[^/]+$/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/cases\/[^/]+\/transition$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/cases\/[^/]+\/resolve$/, resource: "DISPUTES", action: "APPROVE" },
  // Phase 11 — matching diagnostics (read-only: runs the matcher, never dispatches or persists).
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/matching-diagnostics$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/safety\/holds\/[^/]+\/release$/, resource: "BOOKINGS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/safety\/holds$/, resource: "BOOKINGS", action: "APPROVE" },
  // Phase 10 §10 — quality operations view + the one admin verdict action (override, with reason).
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/quality$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/quality\/override$/, resource: "BOOKINGS", action: "APPROVE" },
  // Phase 10 §8 — execution operations view + the one admin step action (reset, with reason).
  { methods: M.GET, pattern: /^\/api\/admin\/bookings\/[^/]+\/execution$/, resource: "BOOKINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/execution\/[^/]+\/reset$/, resource: "BOOKINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/requirements\/[^/]+\/recheck$/, resource: "BOOKINGS", action: "UPDATE" },
  // A refund moves money: it needs the payments permission, not merely booking operations.
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/refund$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/bookings\/[^/]+\/refund\/retry$/, resource: "PAYMENTS", action: "APPROVE" },

  // Disputes / support / fraud
  { methods: M.GET, pattern: /^\/api\/admin\/support\/tickets$/, resource: "DISPUTES", action: "READ" },
  /**
   * Phase-10 support intelligence. `DISPUTES/READ` is quoted from the ticket-read rule below, not
   * chosen: the intelligence describes a ticket, so it must not be reachable by anyone who could not
   * open that ticket. Placed above the `[^/]+$` rule because that pattern would not match this path
   * anyway, and above the broad ticket family so the intent is unambiguous to the next reader.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/intelligence$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/recommendations$/, resource: "DISPUTES", action: "READ" },
  /** A verdict changes a ticket's support record, so it takes the same UPDATE as respond/escalate. */
  { methods: M.POST, pattern: /^\/api\/admin\/support\/tickets\/[^/]+\/recommendation\/verdict$/, resource: "DISPUTES", action: "UPDATE" },
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
  /**
   * Specific finance rules MUST precede the two broad `/finance/` catch-alls below — first match
   * wins (see resolveAdminRoutePermission). Previously the chargeback (DISPUTES) and export
   * (AUDIT_LOGS/EXPORT) rules sat after the catch-alls and were dead: every chargeback mutation
   * resolved to PAYMENTS/APPROVE and every export to PAYMENTS/READ.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/audit-export\//, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/reports\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/settlements\/[^/]+\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/evidence-certificate$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/[^/]+\/evidence-package$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks\/evidence\/download\/[^/]+$/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/chargebacks\/evidence\/[^/]+\/download-token$/, resource: "DISPUTES", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\/chargebacks/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/chargebacks/, resource: "DISPUTES", action: "UPDATE" },
  // Rejections carry their own action so a role can approve without being able to reject (or vice versa).
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/refunds\/[^/]+\/reject$/, resource: "PAYMENTS", action: "REJECT" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/adjustments\/[^/]+\/reject$/, resource: "PAYMENTS", action: "REJECT" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\/payout-batches\/[^/]+\/reject$/, resource: "PAYMENTS", action: "REJECT" },
  { methods: M.GET, pattern: /^\/api\/admin\/finance\//, resource: "PAYMENTS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/finance\//, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/approve$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/reject$/, resource: "PAYMENTS", action: "REJECT" },
  { methods: M.POST, pattern: /^\/api\/admin\/withdrawals\/[^/]+\/process$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/admin\/invoices\/export\.csv$/, resource: "AUDIT_LOGS", action: "EXPORT" },
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
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons\/export$/, resource: "AUDIT_LOGS", action: "EXPORT" },
  { methods: M.GET, pattern: /^\/api\/admin\/membership\/coupons$/, resource: "MEMBERSHIPS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/membership\/coupons$/, resource: "MEMBERSHIPS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/membership\/coupons\/[^/]+$/, resource: "MEMBERSHIPS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/membership\/coupons\/[^/]+\//, resource: "MEMBERSHIPS", action: "UPDATE" },

  // Settings (catalog / services)
  { methods: M.GET, pattern: /^\/api\/admin\/services$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/services$/, resource: "SETTINGS", action: "CREATE" },
  // Reading ONE service is the same permission as reading the list; without this rule the detail
  // endpoint answered 403 `unmapped_route` to every admin role except SUPER_ADMIN.
  { methods: M.GET, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/services\/[^/]+\/versions$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/services\/[^/]+\/lifecycle$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/service-categories$/, resource: "SETTINGS", action: "READ" },
  // Phase 06 requirement catalogue (materials / equipment / customer preconditions): same authority as services.
  { methods: M.GET, pattern: /^\/api\/admin\/requirement-items$/, resource: "SETTINGS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/requirement-items$/, resource: "SETTINGS", action: "CREATE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/requirement-items\/[^/]+$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/services\/[^/]+\/status$/, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.DELETE, pattern: /^\/api\/admin\/services\/[^/]+$/, resource: "SETTINGS", action: "DELETE" },

  /**
   * Routes that were reachable from the console but had no rule, which the RBAC middleware
   * resolves to "SUPER_ADMIN only" (see middleware/admin-rbac.ts). Every non-super role got a 403
   * from a button the UI showed them. Mapped to the same resource/action their neighbours use;
   * document reject mirrors document verify (USERS/APPROVE), which is also what the handler
   * itself enforces.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/reviews$/, resource: "DISPUTES", action: "READ" },
  { methods: M.PATCH, pattern: /^\/api\/admin\/reviews\/[^/]+$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.DELETE, pattern: /^\/api\/admin\/reviews\/[^/]+$/, resource: "DISPUTES", action: "DELETE" },
  { methods: M.PUT, pattern: /^\/api\/admin\/hcoins\/expiry\/config$/, resource: "WALLET", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/hcoins\/expiry\/run$/, resource: "WALLET", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/membership\/coupons\/bulk$/, resource: "MEMBERSHIPS", action: "CREATE" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/alerts$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/archival\/strategy$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/partner-availability$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.PUT, pattern: /^\/api\/admin\/providers\/[^/]+\/documents\/[^/]+\/reject$/, resource: "USERS", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/admin\/observability\/alerts\//, resource: "SETTINGS", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/observability\/validation\/run$/, resource: "SETTINGS", action: "UPDATE" },

  // Audit logs & exports
  { methods: M.GET, pattern: /^\/api\/admin\/observability\/logs/, resource: "AUDIT_LOGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/audit$/, resource: "AUDIT_LOGS", action: "READ" },
  // (finance export / chargeback rules live above the `/finance/` catch-alls — see that block)

  // Admin user management
  /**
   * §8 — which Razorpay world this deployment talks to (TEST or LIVE). Operational intelligence, not
   * public information, so it sits behind the same SETTINGS/READ as the other platform diagnostics.
   * The route itself enforces the permission too; this entry is what makes the coverage check pass
   * and what an auditor reads to see the rule without opening the handler.
   */
  { methods: M.GET, pattern: /^\/api\/admin\/payments\/environment$/, resource: "SETTINGS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/roles$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/admins$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/rbac\/me$/, resource: "ADMIN_USERS", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/rbac\/grant-role$/, resource: "ADMIN_USERS", action: "CREATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/rbac\/revoke-role$/, resource: "ADMIN_USERS", action: "DELETE" },

  // Non-/api/admin scoped routes (P1 RBAC hardening)
  { methods: M.POST, pattern: /^\/api\/payments\/[^/]+\/refund$/, resource: "PAYMENTS", action: "APPROVE" },
  { methods: M.GET, pattern: /^\/api\/v1\/ws\/stats$/, resource: "ANALYTICS", action: "READ" },
  { methods: M.GET, pattern: /^\/api\/admin\/trust-safety\//, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/admin\/trust-safety\/incidents\/[^/]+\/(assign|acknowledge|resolve)$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/trust-safety\/risk\/[^/]+\/review$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.POST, pattern: /^\/api\/admin\/trust-safety\/compliance\/[^/]+\/unrestrict$/, resource: "DISPUTES", action: "UPDATE" },
  { methods: M.GET, pattern: /^\/api\/compliance\/admin\/requests$/, resource: "DISPUTES", action: "READ" },
  { methods: M.POST, pattern: /^\/api\/compliance\/admin\/requests\/[^/]+\/approve$/, resource: "DISPUTES", action: "APPROVE" },
  { methods: M.POST, pattern: /^\/api\/compliance\/admin\/requests\/[^/]+\/reject$/, resource: "DISPUTES", action: "REJECT" },
  { methods: M.GET, pattern: /^\/api\/compliance\/admin\/retention\/report$/, resource: "AUDIT_LOGS", action: "READ" },
];

/** First matching rule wins (order matters — specific paths before broad prefixes). */
export function resolveAdminRoutePermission(
  method: string,
  path: string,
): AdminRoutePermission | null {
  // Trailing slashes off (2026-10-01): Elysia serves "/x/" from the "/x" handler (non-strict paths),
  // but every rule here is anchored with `$`. "/…/export/" therefore resolved to a broader catch-all
  // rule, and on scoped non-admin prefixes ("/api/compliance/admin/…/approve/") to NO rule at all —
  // which skips RBAC and leaves only the handler's "is any admin" check.
  const normalizedPath = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
  for (const rule of rules) {
    if (!rule.methods.includes(method)) continue;
    if (rule.pattern.test(normalizedPath)) {
      return { resource: rule.resource, action: rule.action };
    }
  }
  return null;
}
