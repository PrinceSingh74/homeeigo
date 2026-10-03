import { createHash } from "node:crypto";

/** DPDP-ready PII masking — stable hashes for join keys, never raw identifiers in warehouse. */
/**
 * Overloaded so a caller that has already proven the id exists gets a non-nullable hash back.
 *
 * The single `string | null` signature meant the return was nullable even when the input provably
 * was not, which is why callers writing to NOT NULL columns (e.g. `EtaTrainingLabel.partnerHash`)
 * could not satisfy the compiler without a cast. The nullable overload is unchanged for callers
 * that genuinely may pass nothing, and the runtime behaviour is identical for both.
 */
export function hashPii(id: string): string;
export function hashPii(id: string | null | undefined): string | null;
export function hashPii(id: string | null | undefined): string | null {
  if (!id) return null;
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length > 4 ? `***${phone.slice(-4)}` : "***";
}

export function redactRow(row: Record<string, unknown>, sensitiveKeys: string[]): Record<string, unknown> {
  const out = { ...row };
  for (const key of sensitiveKeys) {
    if (key in out) out[key] = null;
  }
  return out;
}
