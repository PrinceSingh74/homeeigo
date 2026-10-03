/**
 * Owner-approval provenance: the one check every approval path uses.
 *
 * On 2026-09-29 an approval file was emitted with `"approvedBy": "YOUR NAME"` and the Phase 10
 * content was applied to homigo_db under it. That file is historical evidence and is kept as-is;
 * this module stops the same thing from happening again. An approver must be a real name, never a
 * template placeholder copied from a runbook line or typed at a prompt.
 */
const PLACEHOLDER_APPROVERS = new Set([
  "your name",
  "<your name>",
  "owner name",
  "<owner name>",
  "your_name",
  "owner_name",
]);

/** Lower-cased, whitespace-collapsed form used for every comparison. */
export function normalizeApproverName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True only for a name a person could have typed as themselves — never a placeholder. */
export function isValidApproverName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizeApproverName(value);
  if (!normalized) return false;
  if (PLACEHOLDER_APPROVERS.has(normalized)) return false;
  if (/^<[^>]*>$/.test(normalized)) return false; // any "<…>" template slot
  if (/^\$\{?[a-z_]+\}?$/.test(normalized)) return false; // an unexpanded shell variable ($OWNER, ${OWNER})
  if (!/\p{L}/u.test(normalized)) return false; // a name has at least one letter
  return true;
}
