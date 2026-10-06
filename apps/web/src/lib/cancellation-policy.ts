/**
 * What the cancellation card shows, read out of GET /api/bookings/cancellation-policy.
 *
 * Every label, window, percentage and note is the server's. A tier that does not carry what the
 * card prints is dropped, and an empty or unreadable answer yields nothing: the card then says the
 * terms are shown before a cancellation is confirmed. No tier is ever supplied from here.
 */
export type CancellationPolicyResponse = {
  tiers?: unknown;
  providerCancel?: unknown;
  walletNote?: unknown;
  gatewayNote?: unknown;
};

export type CancellationPolicyRow = { id: string; label: string; window: string; refundPercent: number };

export type CancellationPolicyView = { rows: CancellationPolicyRow[]; notes: string[] };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function cancellationPolicyView(data: CancellationPolicyResponse | null | undefined): CancellationPolicyView {
  const tiers = Array.isArray(data?.tiers) ? data.tiers : [];
  const rows: CancellationPolicyRow[] = [];
  for (const raw of tiers) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    // `selfServe: false` marks a tier the customer cannot reach by cancelling (a started job goes
    // through support). Listing it here would offer a cancellation the server refuses.
    if (t.selfServe === false) continue;
    const label = text(t.label);
    const window = text(t.window);
    const pct = t.refundPercent;
    if (!label || !window || typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    rows.push({ id: text(t.id) ?? label, label, window, refundPercent: pct });
  }
  const notes = [data?.providerCancel, data?.walletNote, data?.gatewayNote].map(text).filter((n): n is string => n !== null);
  return { rows, notes };
}
