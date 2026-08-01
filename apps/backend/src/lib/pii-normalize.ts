const INDIA_PHONE_REGEX = /^\+91\d{10}$/;

/** Normalize email for hashing and encryption (lowercase, trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize phone to E.164 where possible.
 * OAuth synthetic phones (`oauth_*`) are preserved as-is.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("oauth_")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  return trimmed;
}

export function isValidIndiaPhone(phone: string): boolean {
  return INDIA_PHONE_REGEX.test(normalizePhone(phone));
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***@***.***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = local.length <= 2 ? `${local[0] ?? "*"}*` : `${local[0]}***${local[local.length - 1]}`;
  const dot = domain.lastIndexOf(".");
  if (dot <= 0) return `${maskedLocal}@***`;
  const domainName = domain.slice(0, dot);
  const tld = domain.slice(dot);
  const maskedDomain = domainName.length <= 1 ? "*" : `${domainName[0]}***`;
  return `${maskedLocal}@${maskedDomain}${tld}`;
}

export function maskPhone(phone: string): string {
  const norm = normalizePhone(phone);
  if (norm.startsWith("oauth_")) return "oauth-****";
  if (norm.length < 6) return "****";
  return `${norm.slice(0, 3)}******${norm.slice(-2)}`;
}
