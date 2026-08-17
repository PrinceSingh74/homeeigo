import { bookingResolver } from "./resolvers/booking.resolver";
import { paymentResolver } from "./resolvers/payment.resolver";
import { ratingResolver } from "./resolvers/rating.resolver";
import { CONDITION_REASON, type ConditionReason, type ConditionResolver, type ResolvedValue, type SubjectRef } from "./types";

/**
 * The allowlist of everything a condition is permitted to read.
 *
 * Three resolvers ship in 6B — the ones the first workflows actually need. Every other domain
 * named in the Phase-6 plan (customer, partner, service, subscription, wallet, earnings, weather,
 * demand, fraud, support, location, ETA) is deliberately NOT IMPLEMENTED: an unknown domain is
 * refused as UNKNOWN_FIELD rather than silently passing, so a condition referencing a resolver
 * that does not exist yet stops its workflow instead of quietly evaluating to true.
 */

const registry = new Map<string, ConditionResolver>();

/**
 * Registers a resolver.
 *
 * Exported so that tests can install a controlled resolver and exercise the real evaluation path
 * rather than a parallel one — particularly for freshness, which no shipped resolver declares yet.
 * That is not a hole: the safety of this design never rested on registration being private. It
 * rests on every resolver being defined in code, declaring the subject types it will answer for,
 * and exposing a fixed field allowlist. A resolver added here is still bound by all three.
 */
export function registerResolver(resolver: ConditionResolver): void {
  registry.set(resolver.domain, resolver);
}

/** Test-only: removes a resolver, so a fixture cannot leak into a later case. */
export function unregisterResolver(domain: string): void {
  registry.delete(domain);
}

registerResolver(bookingResolver);
registerResolver(paymentResolver);
registerResolver(ratingResolver);

export function getResolver(domain: string): ConditionResolver | undefined {
  return registry.get(domain);
}

export function listResolvers(): Array<{ domain: string; subjects: string[]; fields: string[] }> {
  return [...registry.values()].map((r) => ({
    domain: r.domain,
    subjects: r.acceptsSubjectTypes,
    fields: r.fields,
  }));
}

export type ResolveOutcome =
  | { ok: true; resolved: ResolvedValue }
  | { ok: false; reason: ConditionReason; detail: string };

/**
 * Resolves one `<domain>.<field>` path for one workflow subject.
 *
 * The scope check happens here and nowhere else, so there is exactly one place to read to know
 * what automation can see. A resolver that does not accept the instance's subject type is denied
 * before any query runs — the denial is not a filter on results, it is a refusal to look.
 */
export async function resolveField(subject: SubjectRef, path: string): Promise<ResolveOutcome> {
  const parts = path.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: CONDITION_REASON.MALFORMED, detail: `"${path}" is not <domain>.<field>` };
  }
  const [domain, field] = parts;

  const resolver = getResolver(domain);
  if (!resolver) {
    return { ok: false, reason: CONDITION_REASON.UNKNOWN_FIELD, detail: `no resolver for domain "${domain}"` };
  }
  if (!resolver.fields.includes(field)) {
    return { ok: false, reason: CONDITION_REASON.UNKNOWN_FIELD, detail: `"${domain}" does not expose "${field}"` };
  }

  // The approved scoping rule, enforced. Cross-subject reads — including traversal from one
  // subject to a related one — are denied by default.
  if (!resolver.acceptsSubjectTypes.includes(subject.subjectType)) {
    return {
      ok: false,
      reason: CONDITION_REASON.SUBJECT_SCOPE_DENIED,
      detail: `"${domain}" cannot be read by a "${subject.subjectType}" workflow`,
    };
  }

  let resolved: ResolvedValue | null;
  try {
    resolved = await resolver.resolve(subject, field);
  } catch (err) {
    return {
      ok: false,
      reason: CONDITION_REASON.RESOLVER_ERROR,
      detail: err instanceof Error ? err.message.slice(0, 200) : "resolver threw",
    };
  }

  if (resolved === null) {
    return { ok: false, reason: CONDITION_REASON.SUBJECT_NOT_FOUND, detail: `${domain} ${subject.subjectId} not found` };
  }

  /**
   * Freshness, for resolvers that declare they can age.
   *
   * `maxAgeMs` is the resolver saying "my answers have a shelf life". Once it says that, the
   * absence of a timestamp is not permission to skip the check — it is a failure to establish
   * whether the data is usable, and it fails closed.
   *
   * This previously read `maxAgeMs !== undefined && observedAt`, which meant a freshness-sensitive
   * resolver that returned no timestamp sailed straight past the guard. Nothing exploited it,
   * because no shipped resolver declares `maxAgeMs` yet — but the first weather or demand resolver
   * would have inherited a check that quietly did nothing.
   */
  if (resolver.maxAgeMs !== undefined) {
    const observed = resolved.observedAt ?? resolved.generatedAt;

    if (!observed) {
      return {
        ok: false,
        reason: CONDITION_REASON.FRESHNESS_UNKNOWN,
        detail: `${path} declares maxAgeMs but returned no observedAt/generatedAt`,
      };
    }
    if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
      return {
        ok: false,
        reason: CONDITION_REASON.FRESHNESS_UNKNOWN,
        detail: `${path} returned a malformed timestamp`,
      };
    }

    const age = Date.now() - observed.getTime();

    // A future timestamp means a clock disagreement somewhere, and "negative age" is not
    // evidence of freshness — it is evidence that the age cannot be trusted.
    if (age < 0) {
      return {
        ok: false,
        reason: CONDITION_REASON.FRESHNESS_UNKNOWN,
        detail: `${path} is dated ${Math.round(-age / 1000)}s in the future`,
      };
    }

    // Boundary is inclusive: data exactly at maxAgeMs is still considered fresh.
    if (age > resolver.maxAgeMs) {
      return {
        ok: false,
        reason: CONDITION_REASON.STALE_DATA,
        detail: `${path} is ${Math.round(age / 1000)}s old, limit ${Math.round(resolver.maxAgeMs / 1000)}s`,
      };
    }
  }

  return { ok: true, resolved };
}
