const PROHIBITED_KEYS = new Set([
  "email",
  "phone",
  "phoneNumber",
  "password",
  "firstName",
  "lastName",
  "name",
  "fullName",
  "address",
  "street",
  "streetAddress",
  "accessToken",
  "refreshToken",
  "razorpaySignature",
  "cardNumber",
  "deviceFingerprint",
  "browserFingerprint",
  "emailEncrypted",
  "phoneEncrypted",
]);

/** Defense-in-depth: strip known PII keys from event payloads before persistence. */
export function sanitizeEventPayload<T extends Record<string, unknown>>(payload: T): T {
  return scrubObject(payload) as T;
}

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => scrubObject(item, depth + 1));
  if (typeof obj !== "object") return obj;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (PROHIBITED_KEYS.has(key) || PROHIBITED_KEYS.has(lower)) {
      continue;
    }
    if (lower.includes("password") || lower.includes("secret") || lower.includes("token")) {
      continue;
    }
    out[key] = scrubObject(value, depth + 1);
  }
  return out;
}

export function assertNoProhibitedPii(payload: Record<string, unknown>): void {
  const json = JSON.stringify(payload).toLowerCase();
  for (const key of PROHIBITED_KEYS) {
    if (json.includes(`"${key.toLowerCase()}"`)) {
      throw new Error(`Event payload contains prohibited field: ${key}`);
    }
  }
}
