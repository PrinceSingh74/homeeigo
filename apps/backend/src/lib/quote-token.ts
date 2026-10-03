import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { JWT_SECRETS } from "../services/jwt.service";

/**
 * Signed, expiring quote snapshot — stateless on purpose.
 *
 * A quote is the server's commercial statement "this selection costs X until T". The booking
 * never CHARGES the token's amount: it always re-prices from current server data. The token only
 * lets the server prove the customer saw a quote for exactly this selection, and refuse — instead of
 * silently charging a different amount — when the price moved (PRICE_CHANGED) or the quote aged out
 * (QUOTE_EXPIRED). A persisted quote table would add retention and cleanup for no extra guarantee:
 * nothing is honoured from it, so there is nothing to store.
 *
 * Integrity: HMAC-SHA256 with a key derived from the access-token secret (domain-separated, so a
 * quote token can never be replayed as a JWT or vice versa).
 */

export const QUOTE_TTL_SECONDS = Math.max(60, Number(process.env.QUOTE_TTL_SECONDS ?? 15 * 60));

const KEY = createHash("sha256").update(`homigo.quote.v1:${JWT_SECRETS.ACCESS}`).digest();

export type QuotePayload = {
  v: 1;
  /** user the quote was priced for — a quote is not transferable (membership, coupon usage). */
  uid: string;
  sid: string;
  /** service selection-config version priced against */
  sv: number;
  /** hash of the normalized selection + coupon + address */
  sel: string;
  /** payable total in paise */
  fp: number;
  pv: string;
  exp: number;
};

/**
 * Canonical fingerprint of a priced selection. Callers pass the RESOLVER'S normalized selection
 * (defaults applied, add-ons in one order, single-unit add-on quantities dropped), never raw request
 * fields — so "quantity omitted" and "quantity = default", or add-ons in any order, are the same
 * logical selection and the same fingerprint. Computed in exactly one place: the quote engine.
 */
export function selectionFingerprint(input: {
  serviceId: string;
  variantId?: string | null;
  quantity?: number | null;
  audience?: string | null;
  professionalPreference?: string | null;
  addonIds?: string[] | null;
  addonQuantities?: Record<string, number> | null;
  packagePrice?: number | null;
  couponCode?: string | null;
  addressId?: string | null;
}): string {
  const canonical = {
    s: input.serviceId,
    v: input.variantId ?? null,
    q: input.quantity ?? null,
    a: input.audience ?? null,
    p: input.professionalPreference ?? null,
    ad: [...(input.addonIds ?? [])].sort(),
    aq: Object.fromEntries(Object.entries(input.addonQuantities ?? {}).sort(([x], [y]) => x.localeCompare(y))),
    pk: input.packagePrice ?? null,
    c: input.couponCode?.trim().toUpperCase() || null,
    addr: input.addressId ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url").slice(0, 32);
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", KEY).update(body).digest("base64url");

export function signQuote(p: Omit<QuotePayload, "v" | "exp">, now = Date.now()): { token: string; expiresAt: string } {
  const payload: QuotePayload = { v: 1, ...p, exp: Math.floor(now / 1000) + QUOTE_TTL_SECONDS };
  const body = b64(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export type QuoteVerification =
  | { ok: true; payload: QuotePayload }
  | { ok: false; error: "QUOTE_INVALID" | "QUOTE_EXPIRED" };

export function verifyQuote(token: string, now = Date.now()): QuoteVerification {
  const [body, mac] = token.split(".");
  if (!body || !mac || token.length > 2048) return { ok: false, error: "QUOTE_INVALID" };
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, error: "QUOTE_INVALID" };
  let payload: QuotePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QuotePayload;
  } catch {
    return { ok: false, error: "QUOTE_INVALID" };
  }
  if (payload.v !== 1 || typeof payload.exp !== "number") return { ok: false, error: "QUOTE_INVALID" };
  if (payload.exp * 1000 <= now) return { ok: false, error: "QUOTE_EXPIRED" };
  return { ok: true, payload };
}
