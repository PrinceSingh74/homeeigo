/**
 * One booking attempt, one Idempotency-Key.
 *
 * The server replays a booking request that arrives again with the same key and the same request
 * (apps/backend booking-idempotency.service.ts `bookingRequestFingerprint`). For that to protect a
 * customer whose response was lost, the client must send the SAME key on the retry, including
 * after a page refresh. So the key is stored next to a fingerprint of the request it belongs to:
 * the same request reuses it, a different request (another slot, address or selection) gets a new
 * one. The quote token is not part of the request: a refreshed quote is still the same booking.
 */

export type AttemptStore = {
  read(): string | null;
  write(value: string | null): void;
};

export type AttemptFields = {
  serviceId: string;
  addressId: string;
  scheduledDate: string;
  providerId?: string | null;
  variantId?: string | null;
  quantity?: number | null;
  audience?: string | null;
  professionalPreference?: string | null;
  addonIds?: string[] | null;
  addonQuantities?: Record<string, number> | null;
  packagePrice?: number | null;
  couponCode?: string | null;
  description?: string | null;
};

/** Mirrors the server's fingerprint fields, so "same request" means the same thing on both sides. */
export function attemptFingerprint(f: AttemptFields): string {
  return JSON.stringify([
    f.serviceId,
    f.addressId,
    new Date(f.scheduledDate).toISOString(),
    f.providerId ?? null,
    f.variantId ?? null,
    f.quantity ?? null,
    f.audience ?? null,
    f.professionalPreference ?? null,
    [...(f.addonIds ?? [])].sort(),
    Object.entries(f.addonQuantities ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    f.packagePrice ?? null,
    f.couponCode ?? null,
    f.description ?? null,
  ]);
}

/** The key for this request: the stored one when the request is unchanged, otherwise a new one. */
export function attemptKeyFor(store: AttemptStore, fingerprint: string, mint: () => string): string {
  try {
    const raw = store.read();
    const saved = raw ? (JSON.parse(raw) as { fingerprint?: unknown; key?: unknown }) : null;
    if (saved && saved.fingerprint === fingerprint && typeof saved.key === "string" && saved.key) return saved.key;
  } catch {
    // Unreadable or corrupt storage: fall through to a fresh key.
  }
  const key = mint();
  try {
    store.write(JSON.stringify({ fingerprint, key }));
  } catch {
    // Storage unavailable (private mode): the key still protects retries within this page.
  }
  return key;
}

/** The attempt is over: the server answered, so the next confirm is a new attempt. */
export function releaseAttempt(store: AttemptStore): void {
  try {
    store.write(null);
  } catch {
    // Nothing to release.
  }
}

/**
 * Keep the key when the outcome is unknown: no response reached us (network drop), the server
 * failed without saying what happened (5xx), or the first request is still running. A refusal the
 * server explained (price, slot, validation) releases it.
 */
export function keepAttemptAfter(error: unknown): boolean {
  const e = (error ?? {}) as { status?: unknown; code?: unknown };
  if (e.code === "IDEMPOTENCY_IN_PROGRESS") return true;
  if (typeof e.status !== "number") return true; // thrown before any response (fetch TypeError)
  return e.status === 0 || e.status >= 500;
}

const STORAGE_KEY = "homigo.booking-attempt";

/** Per-tab storage: survives a refresh, does not leak an attempt into another tab's booking. */
export function sessionAttemptStore(): AttemptStore {
  let memory: string | null = null;
  return {
    read() {
      try {
        return window.sessionStorage.getItem(STORAGE_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    write(value) {
      memory = value;
      try {
        if (value === null) window.sessionStorage.removeItem(STORAGE_KEY);
        else window.sessionStorage.setItem(STORAGE_KEY, value);
      } catch {
        // Kept in memory only.
      }
    },
  };
}
