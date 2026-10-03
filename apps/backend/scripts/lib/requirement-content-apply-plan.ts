/**
 * Pure planning logic for applying requirement content to a service — kept out of the script so it
 * can be tested (defect reintroduction R13: owner-edited content overwritten; R14: version bump).
 */
import { createHash } from "node:crypto";
import { requirementAssignmentSchema, type RequirementAssignment } from "../../src/lib/service-requirements";

export type PlanAction = "SKIP_IDENTICAL" | "APPLY" | "SUPERSEDE" | "REFUSED_OWNER_EDIT";

/** Order-independent, default-applied canonical form of an assignment list. */
export function canonicalAssignments(list: unknown[]): string {
  return JSON.stringify([...list.map((a) => requirementAssignmentSchema.parse(a))].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * What to do with one service: identical content is skipped (no version bump); content that differs
 * from what is stored is applied only on an empty service or with explicit overwrite — a change made
 * in the admin panel is never replaced silently.
 */
export function planService(input: { current: unknown[]; target: unknown[]; overwrite: boolean; previous?: unknown[] }): { action: PlanAction; reason: string } {
  const { current, target, overwrite, previous } = input;
  if (current.length && canonicalAssignments(current) === canonicalAssignments(target)) return { action: "SKIP_IDENTICAL", reason: `${current.length} assignments already match` };
  // Upgrading our own content: the stored rows are byte-for-byte the previous artifact → nobody edited them since, so replace.
  if (current.length && previous && canonicalAssignments(current) === canonicalAssignments(previous)) return { action: "SUPERSEDE", reason: `stored content equals the superseded artifact; ${target.length} assignments replace ${current.length}` };
  if (current.length && !overwrite) return { action: "REFUSED_OWNER_EDIT", reason: `service already has ${current.length} requirement(s) that differ — --overwrite to replace` };
  return { action: "APPLY", reason: `${target.length} assignments (currently ${current.length})` };
}

/** Stable hash of a content set — the artifact every live write is tied to. */
export function contentHash(input: { version: string; catalogue: unknown[]; content: Record<string, { assignments: RequirementAssignment[] }> }): string {
  const canon = {
    version: input.version,
    catalogue: [...input.catalogue].sort((a, b) => String((a as { code: string }).code).localeCompare(String((b as { code: string }).code))),
    content: Object.fromEntries(Object.keys(input.content).sort().map((k) => [k, canonicalAssignments(input.content[k]!.assignments.map(({ ...a }) => { delete (a as { meta?: unknown }).meta; return a; }))])),
  };
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
