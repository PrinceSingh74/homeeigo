/**
 * How a catalogue service sits on one partner.
 *
 * While a partner has no typed capability rows, dispatch still trusts the signup
 * `serviceCategories` list. The moment any row exists, dispatch requires an ACTIVE
 * row for that exact service. Classification follows that rule so the screens and
 * the matcher agree.
 */
export type ServiceSkillLane = "performing" | "pending" | "suspended" | "revoked" | "available";

export type ServiceCapabilityStatus = "REQUESTED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export function classifyServiceSkill(input: {
  offersViaCategories: boolean;
  capabilityStatus: ServiceCapabilityStatus | null;
  hasAnyCapabilityRow: boolean;
}): ServiceSkillLane {
  if (input.capabilityStatus === "ACTIVE") return "performing";
  if (input.capabilityStatus === "REQUESTED") return "pending";
  if (input.capabilityStatus === "SUSPENDED") return "suspended";
  if (input.capabilityStatus === "REVOKED") return "revoked";
  if (!input.hasAnyCapabilityRow && input.offersViaCategories) return "performing";
  return "available";
}

/** Signup list plus the service id and slug dispatch already accepts. */
export function withServiceTokens(categories: readonly string[], serviceId: string, slug: string): string[] {
  const next = new Set(categories);
  next.add(serviceId);
  next.add(slug);
  return [...next];
}

/** Drops only this service's id and slug. Category-wide signup labels stay. */
export function withoutServiceTokens(categories: readonly string[], serviceId: string, slug: string): string[] {
  const drop = new Set([serviceId, slug]);
  return categories.filter((entry) => !drop.has(entry));
}
