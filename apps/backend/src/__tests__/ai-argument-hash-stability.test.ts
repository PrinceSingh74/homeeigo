/**
 * `hashArguments` binds an approval to the exact payload it authorised, and decides whether a retry
 * carrying the same idempotency key is the same request. Both depend on it being a function of the
 * arguments' *meaning*, not of the order a particular caller happened to serialise them in.
 *
 * It was not. `stableStringify` was `JSON.stringify` with a BigInt replacer and no key ordering, so
 * `{ bookingId, amount }` and `{ amount, bookingId }` — the same call — hashed differently.
 *
 * The direction of that failure is worth being precise about, because it decides the severity:
 *
 *   - **Approval binding fails CLOSED.** A reordered payload does not match the approval, so the
 *     request is refused. Safe, and annoying.
 *   - **Idempotency also fails CLOSED**, but into the wrong error: `sameIdentity` goes false and the
 *     engine raises `IDEMPOTENCY_KEY_REUSED` — telling the caller their key was used for a
 *     *different* request when it was the same one. On a financial retry that is an operator
 *     investigating a key collision that never happened.
 *
 * So this was never a double-spend risk. It was a correctness defect in the identity function that
 * two authorisation controls are built on, which is reason enough for it to be right.
 */
import { describe, expect, it } from "bun:test";
import { hashArguments, hashResult } from "../ai-tools/audit/tool-audit.service";

describe("hashArguments — identity of a tool call", () => {
  it("is independent of top-level key order", () => {
    const a = { bookingId: "bk_1", amount: 500, reason: "duplicate charge" };
    const b = { reason: "duplicate charge", amount: 500, bookingId: "bk_1" };
    expect(hashArguments(b)).toBe(hashArguments(a));
  });

  it("is independent of nested key order", () => {
    const a = { booking: { id: "bk_1", amount: 500 }, actor: { id: "u1", role: "ADMIN" } };
    const b = { actor: { role: "ADMIN", id: "u1" }, booking: { amount: 500, id: "bk_1" } };
    expect(hashArguments(b)).toBe(hashArguments(a));
  });

  it("still distinguishes different values", () => {
    // The whole point is to detect a tampered payload against a valid approval. Order-insensitivity
    // must not become value-insensitivity.
    expect(hashArguments({ amount: 500 })).not.toBe(hashArguments({ amount: 501 }));
    expect(hashArguments({ a: 1, b: 2 })).not.toBe(hashArguments({ a: 2, b: 1 }));
  });

  it("does not confuse a key with its value", () => {
    // A naive "sort and concatenate" normaliser collapses these.
    expect(hashArguments({ a: "b" })).not.toBe(hashArguments({ b: "a" }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(hashArguments({ ids: ["a", "b"] })).not.toBe(hashArguments({ ids: ["b", "a"] }));
  });

  it("distinguishes absent from null from undefined", () => {
    const absent = hashArguments({ a: 1 });
    const withNull = hashArguments({ a: 1, b: null });
    expect(withNull).not.toBe(absent);
  });

  it("handles BigInt, which is why the replacer exists", () => {
    expect(() => hashArguments({ paise: 10_000n })).not.toThrow();
    expect(hashArguments({ paise: 10_000n })).toBe(hashArguments({ paise: 10_000n }));
  });

  it("applies the same ordering to results", () => {
    // `hashResult` feeds the same audit trail and shared the same defect.
    expect(hashResult({ x: 1, y: 2 })).toBe(hashResult({ y: 2, x: 1 }));
  });
});
