/**
 * The cancellation card shows the SERVER's policy (GET /api/bookings/cancellation-policy), never
 * tiers written into the client. The card used to hardcode 100 / 90 / 75% after the server had
 * moved to a two-tier policy, so checkout promised a 90% window that no longer existed.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { cancellationPolicyView } from "@/lib/cancellation-policy";

const SERVER = {
  tiers: [
    { id: "free", label: "Free cancellation", window: "2 hours or more before service", feePercent: 0, refundPercent: 100, minHoursBefore: 2, message: "Free cancellation — full refund." },
    { id: "late", label: "Late cancellation", window: "Under 2 hours before service", feePercent: 25, refundPercent: 75, minHoursBefore: 0, message: "25% cancellation fee applies." },
    { id: "in_progress", selfServe: false, label: "Service started", window: "While professional is on-site (customer cancel)", feePercent: 50, refundPercent: 50, minHoursBefore: null, message: "50% refund." },
  ],
  providerCancel: "Full refund when the professional cancels.",
  walletNote: "Wallet payments are refunded instantly to your HOMEEIGO wallet.",
  gatewayNote: "Card/UPI refunds typically arrive in 5–7 business days.",
};

describe("cancellationPolicyView", () => {
  test("rows are the server's tiers, in the server's order, with the server's numbers", () => {
    const view = cancellationPolicyView(SERVER);
    expect(view.rows).toEqual([
      { id: "free", label: "Free cancellation", window: "2 hours or more before service", refundPercent: 100 },
      { id: "late", label: "Late cancellation", window: "Under 2 hours before service", refundPercent: 75 },
    ]);
  });

  test("a tier the customer cannot invoke themselves is not offered as a cancellation option", () => {
    const view = cancellationPolicyView(SERVER);
    expect(view.rows.some((r) => r.id === "in_progress")).toBe(false);
  });

  test("the notes are the server's sentences, verbatim", () => {
    expect(cancellationPolicyView(SERVER).notes).toEqual([SERVER.providerCancel, SERVER.walletNote, SERVER.gatewayNote]);
  });

  test("nothing from the server means nothing shown — no default tiers", () => {
    for (const empty of [undefined, null, {}, { tiers: [] }, { tiers: "oops" }]) {
      const view = cancellationPolicyView(empty);
      expect(view.rows).toEqual([]);
      expect(view.notes).toEqual([]);
    }
  });

  test("a malformed tier is dropped rather than rendered with an invented number", () => {
    const view = cancellationPolicyView({
      tiers: [
        { id: "x", label: "No percent", window: "sometime" },
        { id: "y", label: "Bad percent", window: "sometime", refundPercent: "90" },
        { id: "z", label: "Out of range", window: "sometime", refundPercent: 140 },
        null,
        { id: "ok", label: "Fine", window: "Any time", refundPercent: 0 },
      ],
      walletNote: 42,
    });
    expect(view.rows).toEqual([{ id: "ok", label: "Fine", window: "Any time", refundPercent: 0 }]);
    expect(view.notes).toEqual([]);
  });
});
