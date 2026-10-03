import crypto from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** Cryptographically random partner referral code. Not a sequential id. */
export function generatePartnerReferralCode(): string {
  const bytes = crypto.randomBytes(10);
  let body = "";
  for (let i = 0; i < 8; i++) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `HP${body}`;
}

export function normalizePartnerReferralCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isPartnerReferralCodeShape(code: string): boolean {
  const n = normalizePartnerReferralCode(code);
  return /^HP[A-Z0-9]{8}$/.test(n);
}
