/**
 * One booking attempt, one Idempotency-Key, across retries and a page refresh.
 *
 * Run from apps/web: `bun test tests/booking`.
 *
 * The key used to live in a React ref: a refresh after a dropped response minted a new key, so the
 * retry was a second booking request rather than a replay of the first.
 */
import { describe, expect, test } from "bun:test";
import { attemptFingerprint, attemptKeyFor, keepAttemptAfter, releaseAttempt, type AttemptStore } from "@/lib/booking-attempt";

function memoryStore(): AttemptStore & { raw: string | null } {
  const s = {
    raw: null as string | null,
    read: () => s.raw,
    write: (value: string | null) => {
      s.raw = value;
    },
  };
  return s;
}

const fields = {
  serviceId: "svc1",
  addressId: "addr1",
  scheduledDate: "2026-10-10T04:30:00.000Z",
  variantId: "fabric",
  quantity: 2,
  addonIds: ["b", "a"],
  couponCode: null,
  description: "Ring the bell",
};

let n = 0;
const mint = () => `key-${++n}`;

describe("attempt key", () => {
  test("the same request keeps its key across a retry and a reload of the store", () => {
    const store = memoryStore();
    const first = attemptKeyFor(store, attemptFingerprint(fields), mint);
    const retry = attemptKeyFor(store, attemptFingerprint(fields), mint);
    expect(retry).toBe(first);
    // A refresh: a new page reads the same storage.
    const reloaded: AttemptStore = { read: () => store.raw, write: store.write };
    expect(attemptKeyFor(reloaded, attemptFingerprint(fields), mint)).toBe(first);
  });

  test("add-on order does not change the request", () => {
    expect(attemptFingerprint({ ...fields, addonIds: ["a", "b"] })).toBe(attemptFingerprint(fields));
  });

  test("a different slot, address or selection is a new attempt with a new key", () => {
    const store = memoryStore();
    const first = attemptKeyFor(store, attemptFingerprint(fields), mint);
    for (const changed of [
      { ...fields, scheduledDate: "2026-10-10T05:30:00.000Z" },
      { ...fields, addressId: "addr2" },
      { ...fields, quantity: 3 },
      { ...fields, addonIds: ["a"] },
    ]) {
      expect(attemptKeyFor(store, attemptFingerprint(changed), mint)).not.toBe(first);
    }
  });

  test("after release the same request gets a new key", () => {
    const store = memoryStore();
    const first = attemptKeyFor(store, attemptFingerprint(fields), mint);
    releaseAttempt(store);
    expect(attemptKeyFor(store, attemptFingerprint(fields), mint)).not.toBe(first);
  });

  test("a corrupt stored value is replaced, not thrown", () => {
    const store = memoryStore();
    store.raw = "{not json";
    expect(attemptKeyFor(store, attemptFingerprint(fields), mint)).toMatch(/^key-/);
  });
});

describe("which failures keep the key", () => {
  test("an unseen outcome keeps it: network drop, timeout, still in progress", () => {
    expect(keepAttemptAfter({ status: 0 })).toBe(true);
    expect(keepAttemptAfter({ status: 504 })).toBe(true);
    expect(keepAttemptAfter({ status: 409, code: "IDEMPOTENCY_IN_PROGRESS" })).toBe(true);
    expect(keepAttemptAfter(new TypeError("Failed to fetch"))).toBe(true);
  });
  test("a server answer releases it: price, slot, validation", () => {
    expect(keepAttemptAfter({ status: 409, code: "PRICE_CHANGED" })).toBe(false);
    expect(keepAttemptAfter({ status: 400, code: "QUOTE_REQUIRED" })).toBe(false);
    expect(keepAttemptAfter({ status: 422, code: "SLOT_UNAVAILABLE" })).toBe(false);
  });
});
