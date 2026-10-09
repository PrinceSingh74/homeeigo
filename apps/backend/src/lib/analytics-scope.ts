/**
 * The one place that decides which rows count as business.
 *
 * Before provenance existed, 97% of `refund_requests` were certification or test artifacts and
 * every refund analytic — approval rate, failure rate, time-to-resolve, the console's "needs retry"
 * tile — was computed over that population. The figures were arithmetically correct and described
 * test activity.
 *
 * The obvious next step would be to sprinkle `WHERE data_origin = ...` through the analytics code.
 * That is the failure mode this module exists to prevent: dozens of ad-hoc predicates drift, and
 * the one that is forgotten silently reintroduces the problem. There is exactly one policy, stated
 * once, and every caller asks for it by name.
 *
 * ── The default ───────────────────────────────────────────────────────────────────────────────
 *
 *   REAL, plus UNKNOWN (NULL).
 *
 * UNKNOWN is included deliberately. Historical rows predate the column, and excluding them would
 * erase genuine business history from every report the day this shipped. Including them fails safe
 * for real data and unsafe only for a script that creates business-shaped rows without declaring
 * provenance — which is prevented at the source, not here.
 *
 * `INFERRED_*` values are treated exactly as their declared counterparts: an inferred certification
 * row is excluded from business analytics just as a declared one is. The prefix records HOW the row
 * was classified, never WHETHER it counts.
 */
import type { DataOrigin, Prisma } from "@prisma/client";

/** Everything that is not business activity, declared or inferred. */
export const NON_BUSINESS_ORIGINS: DataOrigin[] = [
  "FIXTURE",
  "TEST",
  "CERTIFICATION",
  "SYNTHETIC",
  "INFERRED_FIXTURE",
  "INFERRED_TEST",
  "INFERRED_CERTIFICATION",
  "INFERRED_SYNTHETIC",
];

/**
 * Origins created by automated suites. A paid customer job must never be offered to one of these.
 * `@homigo.demo` seed accounts are also not in this list. They stay out of the strict pool
 * (`isBusinessRow` is false) and are considered only by the paid-dispatch widening pass, and only
 * when the address is the seed domain (`isMarketplaceSeedAccount`). RFC 2606 fixture addresses
 * share the INFERRED_SYNTHETIC label and must not be offered a real customer's job.
 * Measured 2026-10-03: every paid booking exhausted with zero offers because the only on-duty
 * partner was a seed account (`HOMIGO-20261003-00013`).
 */
export const AUTOMATED_SUITE_ORIGINS: DataOrigin[] = [
  "FIXTURE",
  "TEST",
  "CERTIFICATION",
  "INFERRED_FIXTURE",
  "INFERRED_TEST",
  "INFERRED_CERTIFICATION",
];

/**
 * Candidate filter used only after the strict (same-provenance) pool produced nobody who can take
 * the job. Real and unclassified partners stay eligible, and so does a seed/demo partner who is
 * actually on duty. Suite fixtures stay out.
 */
export function dispatchFallbackWhere(): Prisma.UserWhereInput {
  return {
    OR: [{ dataOrigin: null }, { dataOrigin: { notIn: AUTOMATED_SUITE_ORIGINS } }],
  };
}

export type AnalyticsPopulation =
  /** Default. Real business activity plus unclassified history. */
  | "BUSINESS"
  /** Only rows a creator explicitly declared REAL. Stricter, and excludes all history. */
  | "DECLARED_REAL_ONLY"
  /** Only synthetic populations — for auditing test data, never for a business report. */
  | "NON_BUSINESS"
  /** Everything. Must be requested by name so it can never be the accidental default. */
  | "ALL";

/**
 * Prisma `where` fragment for a population.
 *
 * Spread into an existing filter:
 *
 *   prisma.refundRequest.count({ where: { status: "FAILED", ...analyticsWhere() } })
 */
export function analyticsWhere(population: AnalyticsPopulation = "BUSINESS"): Prisma.JsonObject | object {
  switch (population) {
    case "BUSINESS":
      // NULL is UNKNOWN and counts as business; see the module note.
      return { OR: [{ dataOrigin: null }, { dataOrigin: "REAL" as DataOrigin }] };
    case "DECLARED_REAL_ONLY":
      return { dataOrigin: "REAL" as DataOrigin };
    case "NON_BUSINESS":
      return { dataOrigin: { in: NON_BUSINESS_ORIGINS } };
    case "ALL":
      return {};
  }
}

/**
 * The same policy as raw SQL, for the analytics paths that are hand-written queries.
 *
 * Takes the table alias so it can be dropped into a join without ambiguity. Returns a predicate
 * safe to `AND` onto an existing `WHERE`.
 */
export function analyticsSqlPredicate(alias: string, population: AnalyticsPopulation = "BUSINESS"): string {
  const col = `${alias}.data_origin`;
  switch (population) {
    case "BUSINESS":
      return `(${col} IS NULL OR ${col} = 'REAL')`;
    case "DECLARED_REAL_ONLY":
      return `(${col} = 'REAL')`;
    case "NON_BUSINESS":
      return `(${col} IS NOT NULL AND ${col} <> 'REAL')`;
    case "ALL":
      return "TRUE";
  }
}

/**
 * Relations through which a table without its own `data_origin` column inherits one.
 *
 * Only `users`, `bookings`, `refund_requests`, `services` and `analytics_events` carry the column.
 * Most analytics do not stop at those: unit economics divides GMV (from `payments`) by completed
 * bookings, satisfaction averages `ratings`, membership funnels count `user_subscriptions`.
 * `analytics_events.data_origin` is stamped at write from the actor or related booking — never
 * from the client — so `analyticsWhere()` applies directly (no inheritance hop).
 *
 * Scoping only the tables that happen to have the column would make those reports *worse*, not
 * better — GMV would still include fixture payments while the booking count excluded the fixture
 * bookings those very payments belong to, so the average order value would be wrong in a new way
 * that is harder to notice than the original. A partial filter is not a smaller version of a
 * correct one.
 *
 * Every one of these tables has a mandatory FK to a row that does carry provenance — a payment
 * cannot exist without its booking, a provider without its user — so the parent's classification
 * is the child's, with no second source of truth and no column to backfill.
 */
export const INHERITS_PROVENANCE_VIA = {
  payment: "booking",
  rating: "booking",
  userSubscription: "user",
  walletTransaction: "user",
  provider: "user",
  membershipBenefitUsage: "user",
  /** The buyer, not the recipient: a gift card is revenue from the account that paid for it. */
  giftCard: "purchaser",
} as const;

/**
 * The models above whose parent FK is nullable, and therefore can have a parentless row.
 *
 * Only `wallet_transactions.user_id` is nullable. This is not a detail: `{ userId: null }` against a
 * required FK is not a filter that matches nothing, it is a query Prisma refuses outright, so
 * admitting orphans everywhere turned `analyticsWhereVia` into a runtime error for five of the six
 * models. The adoption test caught it on `provider`.
 */
const NULLABLE_PARENT = new Set<InheritingModel>(["walletTransaction"]);

export type InheritingModel = keyof typeof INHERITS_PROVENANCE_VIA;

/**
 * Population filter for a table that inherits provenance from a parent.
 *
 *   prisma.payment.aggregate({ where: { status: "PAID", ...analyticsWhereVia("payment") } })
 *
 * For a nullable parent (`walletTransaction.user`) `BUSINESS` also admits the parentless row: an
 * orphan has no provenance to inherit, which makes it UNKNOWN, and UNKNOWN counts as business for
 * the same reason a NULL column does. For a required parent it does not, because `{ userId: null }`
 * against a non-nullable FK is a query Prisma rejects outright.
 *
 * ── Composing it ──────────────────────────────────────────────────────────────────────────────
 *
 * Spreading is safe ONLY when the caller does not already filter the same relation. This returns a
 * `{ [relation]: ... }` key, so
 *
 *   { user: { role: "CUSTOMER" }, ...analyticsWhereVia("provider") }   // WRONG
 *
 * silently discards `role: "CUSTOMER"` — later keys win in an object literal, and the query widens
 * instead of narrowing. It does not error, and the count simply comes back larger. When the caller
 * already constrains the relation, combine explicitly:
 *
 *   { AND: [{ user: { role: "CUSTOMER" } }, analyticsWhereVia("provider")] }
 */
export function analyticsWhereVia(
  model: InheritingModel,
  population: AnalyticsPopulation = "BUSINESS",
): Prisma.JsonObject | object {
  const relation = INHERITS_PROVENANCE_VIA[model];
  if (population === "ALL") return {};
  const parent = { [relation]: analyticsWhere(population) };
  if (population !== "BUSINESS" || !NULLABLE_PARENT.has(model)) return parent;
  // An orphan has no provenance to inherit, which makes it UNKNOWN — and UNKNOWN counts as
  // business, for the same reason a NULL column does.
  return { OR: [parent, { [`${relation}Id`]: null }] };
}

/**
 * The same inheritance as raw SQL. `childAlias` is the table being filtered; `parentAlias` is the
 * already-joined parent. This does NOT add the join — a predicate that silently changes the shape
 * of a query is how a report ends up with duplicated rows.
 */
export function analyticsSqlPredicateVia(parentAlias: string, population: AnalyticsPopulation = "BUSINESS"): string {
  return analyticsSqlPredicate(parentAlias, population);
}

/**
 * Whether a single row counts as business, for in-memory filtering.
 *
 * Mirrors `analyticsWhere("BUSINESS")` exactly — a second definition of "business" is how the two
 * would eventually disagree.
 */
export function isBusinessRow(dataOrigin: DataOrigin | null | undefined): boolean {
  return dataOrigin == null || dataOrigin === "REAL";
}
