export type CancellationActor = "user" | "provider" | "admin";

/**
 * How much an ADMIN cancellation returns. Chosen per cancellation by the admin, never defaulted to
 * something the published policy does not say:
 *   customer_policy  the same tiers a customer cancelling now would get (the published policy)
 *   full             everything still refundable (platform-side reason: no partner, ops error, …)
 */
export type AdminRefundPolicy = "customer_policy" | "full";

export type CancellationTier =
  | "free"
  | "standard"
  | "late"
  /** @deprecated Never published and no longer returned; `late` is the id for the under-2-hours tier. */
  | "very_late"
  | "in_progress"
  | "provider_cancel"
  | "admin_full";

export interface CancellationQuote {
  paidAmount: number;
  feeAmount: number;
  feePercent: number;
  refundAmount: number;
  tier: CancellationTier;
  message: string;
  refundMethodHint: "wallet_instant" | "gateway_5_7_days";
  /**
   * Whether the CUSTOMER can act on this quote themselves (O3b).
   *
   * A quote for a started job describes what a controlled stop settles at, not something the
   * customer may invoke — showing them the numbers with a live "Cancel" button would promise an
   * action the server refuses with SERVICE_IN_PROGRESS.
   */
  selfServe: boolean;
}

export interface CancellationPolicyTier {
  id: CancellationTier;
  label: string;
  window: string;
  feePercent: number;
  refundPercent: number;
  /**
   * Hours before the appointment at which this tier starts applying, or null for a tier selected by
   * booking STATUS rather than by time (`in_progress`). `boundary` records whether the threshold
   * itself belongs to this tier: the published policy reads "more than 24 hours" (exclusive) and
   * "2-24 hours" (inclusive), and the original hard-coded comparisons were `> 24` and `>= 2`. They
   * are written out rather than normalised, because normalising them would move real money at the
   * exact boundary.
   */
  minHoursBefore: number | null;
  boundary?: "inclusive" | "exclusive";
  /**
   * Whether a CUSTOMER may reach this tier by cancelling the booking themselves.
   *
   * O3b (owner decision 2026-09-23): once the service has started, a customer may not use the
   * ordinary cancellation path at all — it routes to the controlled-stop / service-exception flow,
   * which is authorised (admin, or the partner ending their own job). The tier stays as DATA
   * because a controlled stop still settles at these numbers; what changed is who may invoke it.
   * Absent means true, so every existing tier keeps its meaning.
   */
  selfServe?: boolean;
  /** Customer-facing sentence for this tier. */
  message: string;
}

/**
 * The cancellation policy as DATA, with a version.
 *
 * Phase 09: a booking freezes this at creation (`serviceConfigSnapshot.policy.cancellation`) and its
 * cancellation is quoted against the frozen copy. Before that, the live constants were applied to
 * every booking however old, so editing the policy silently re-priced refunds for bookings already
 * sold under different terms. Bookings made before the snapshot existed carry none and fall back to
 * the current policy — the only honest answer for a row that never recorded one.
 */
/**
 * The ACTIVE policy version. Bookings freeze whichever version was active when they were placed, so
 * publishing a new one never re-prices a refund for a booking already sold (see §60, §66).
 */
export const CANCELLATION_POLICY_VERSION = "cancellation.v2";

export interface CancellationPolicySnapshot {
  version: string;
  tiers: CancellationPolicyTier[];
}

/** Public policy tiers — shown at checkout and in support docs, and applied by `calculate`. */
export const CANCELLATION_POLICY_TIERS: CancellationPolicyTier[] = [
  {
    id: "free",
    label: "Free cancellation",
    window: "More than 24 hours before service",
    feePercent: 0,
    refundPercent: 100,
    minHoursBefore: 24,
    boundary: "exclusive",
    message: "Free cancellation — full refund.",
  },
  {
    id: "standard",
    label: "Standard window",
    window: "2–24 hours before service",
    feePercent: 10,
    refundPercent: 90,
    minHoursBefore: 2,
    boundary: "inclusive",
    message: "10% cancellation fee applies (2–24 hours before service).",
  },
  {
    /**
     * `late` is the id the published policy has always carried. `calculate` used to return
     * `very_late` for this same window, so no client could match the tier it was given against the
     * tier list it was shown. The amounts were identical (25% fee / 75% refund) and nothing persists
     * the id, so aligning them changes no money and no history.
     */
    id: "late",
    label: "Late cancellation",
    window: "Under 2 hours before service",
    feePercent: 25,
    refundPercent: 75,
    minHoursBefore: 0,
    boundary: "inclusive",
    message: "25% cancellation fee applies (under 2 hours before service).",
  },
  {
    id: "in_progress",
    selfServe: false,
    label: "Service started",
    window: "While professional is on-site (customer cancel)",
    feePercent: 50,
    refundPercent: 50,
    minHoursBefore: null,
    message: "50% refund — service was already in progress.",
  },
];

/**
 * cancellation.v1 — the tiers in force until 2026-09-23.
 *
 * Kept as data, not deleted: bookings placed under it carry it in their snapshot and must keep being
 * quoted and charged by it. This constant is what a replay, an audit or a support question about an
 * older booking reads.
 */
export const CANCELLATION_POLICY_V1: CancellationPolicySnapshot = {
  version: "cancellation.v1",
  tiers: CANCELLATION_POLICY_TIERS,
};

/**
 * cancellation.v2 — owner decision 2026-09-23 (§54).
 *
 *   >= 2 hours before start   no cancellation fee
 *   <  2 hours                the configured late fee (unchanged at 25%)
 *   after the service starts  50%, unchanged — see the note below
 *
 * What changed from v1: the 2–24 hour window charged 10% and now charges nothing. That is a real
 * change to customer terms, which is exactly why it is a NEW VERSION rather than an edit: every
 * booking already placed keeps the terms it was sold under, and only bookings placed from now on
 * are quoted v2.
 *
 * What did NOT change, and why: §54 also says a booking should not be cancellable once the service
 * has started, and should route through the no-show rules instead. Those rules (§52/§53) do not
 * exist yet, and removing the in-progress tier before they do would leave a started job with no
 * cancellation path at all — for the customer, the partner or support. The tier therefore stays at
 * 50% until the no-show path exists to replace it.
 */
const V2_TIERS: CancellationPolicyTier[] = [
  {
    id: "free",
    label: "Free cancellation",
    window: "2 hours or more before service",
    feePercent: 0,
    refundPercent: 100,
    minHoursBefore: 2,
    boundary: "inclusive",
    message: "Free cancellation — full refund.",
  },
  {
    id: "late",
    label: "Late cancellation",
    window: "Under 2 hours before service",
    feePercent: 25,
    refundPercent: 75,
    minHoursBefore: 0,
    boundary: "inclusive",
    message: "25% cancellation fee applies (under 2 hours before service).",
  },
  {
    id: "in_progress",
    selfServe: false,
    label: "Service started",
    window: "While professional is on-site (customer cancel)",
    feePercent: 50,
    refundPercent: 50,
    minHoursBefore: null,
    message: "50% refund — service was already in progress.",
  },
];

export const CANCELLATION_POLICY: CancellationPolicySnapshot = {
  version: CANCELLATION_POLICY_VERSION,
  tiers: V2_TIERS,
};

/** Every published version, newest first — for admin diagnostics and for replaying an old booking. */
export const CANCELLATION_POLICY_VERSIONS: CancellationPolicySnapshot[] = [CANCELLATION_POLICY, CANCELLATION_POLICY_V1];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hoursUntil(scheduledDate: Date, now: Date): number {
  return (scheduledDate.getTime() - now.getTime()) / (60 * 60 * 1000);
}

export class CancellationPolicyService {
  calculate(opts: {
    paidAmount: number;
    scheduledDate: Date;
    bookingStatus: string;
    cancelledBy: CancellationActor;
    adminRefundPolicy?: AdminRefundPolicy;
    paymentMethod?: string | null;
    now?: Date;
    /** The policy frozen on the booking. Omitted for rows created before snapshots existed. */
    policy?: CancellationPolicySnapshot | null;
  }): CancellationQuote {
    const now = opts.now ?? new Date();
    const policy = opts.policy ?? CANCELLATION_POLICY;
    const paid = round2(Math.max(0, opts.paidAmount));
    const isWallet = (opts.paymentMethod ?? "").toLowerCase() === "wallet";

    if (opts.cancelledBy === "admin" && opts.adminRefundPolicy === "full") {
      return {
        paidAmount: paid,
        feeAmount: 0,
        feePercent: 0,
        refundAmount: paid,
        tier: "admin_full",
        message: "Full refund — cancelled by Homeeigo support.",
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
        // An admin-authorised outcome, reached through support, never by the customer alone.
        selfServe: false,
      };
    }
    // An admin applying the customer policy is quoted exactly as the customer would be.

    if (opts.cancelledBy === "provider") {
      const refundAmount = paid;
      return {
        paidAmount: paid,
        feeAmount: 0,
        feePercent: 0,
        refundAmount,
        tier: "provider_cancel",
        message: "Full refund — the professional cancelled your booking.",
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
        // The partner's own action; the customer is not the one invoking it.
        selfServe: false,
      };
    }

    const quoteFor = (tier: CancellationPolicyTier): CancellationQuote => {
      const refundAmount = round2((paid * (100 - tier.feePercent)) / 100);
      return {
        paidAmount: paid,
        feeAmount: round2(paid - refundAmount),
        feePercent: tier.feePercent,
        refundAmount,
        tier: tier.id,
        message: tier.message,
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
        selfServe: tier.selfServe !== false,
      };
    };

    if (opts.bookingStatus === "IN_PROGRESS") {
      const inProgress = policy.tiers.find((t) => t.id === "in_progress");
      // A policy without the tier cannot be applied, and guessing a number here would be inventing
      // one. Fall back to the platform policy's tier rather than silently refunding something else.
      return quoteFor(inProgress ?? CANCELLATION_POLICY.tiers.find((t) => t.id === "in_progress")!);
    }

    const hours = hoursUntil(opts.scheduledDate, now);

    // Time tiers, most lenient first. The first whose threshold the booking still clears wins.
    const timed = policy.tiers
      .filter((t) => t.minHoursBefore !== null)
      .sort((a, b) => (b.minHoursBefore ?? 0) - (a.minHoursBefore ?? 0));
    for (const tier of timed) {
      const threshold = tier.minHoursBefore ?? 0;
      const clears = tier.boundary === "exclusive" ? hours > threshold : hours >= threshold;
      if (clears) return quoteFor(tier);
    }
    // A policy with no time tier at all describes no answer for this cancellation; the platform
    // policy's last tier is the documented one rather than an invented number.
    return quoteFor(CANCELLATION_POLICY.tiers.filter((t) => t.minHoursBefore !== null).at(-1)!);
  }

  /**
   * What checkout and the policy page show: the tiers of the ACTIVE version, so what a customer is
   * told before booking is what their booking will freeze and later be charged by.
   */
  listPublicTiers(): CancellationPolicyTier[] {
    return CANCELLATION_POLICY.tiers;
  }

  /** The active version id, for the booking snapshot and for admin diagnostics. */
  activeVersion(): string {
    return CANCELLATION_POLICY.version;
  }
}

export const cancellationPolicyService = new CancellationPolicyService();

/**
 * Reads the cancellation policy a booking froze at creation out of its `serviceConfigSnapshot`.
 *
 * The snapshot is data written by an older version of this code, so it is VALIDATED rather than
 * trusted: a row whose policy is missing, malformed, or carries no usable tier returns null, and the
 * caller falls back to the current published policy. Silently applying a half-parsed policy would
 * change a refund amount on the strength of a bad row.
 */
export function cancellationPolicyFromSnapshot(snapshot: unknown): CancellationPolicySnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const policy = (snapshot as { policy?: { cancellation?: unknown } }).policy?.cancellation;
  if (!policy || typeof policy !== "object") return null;
  const candidate = policy as Partial<CancellationPolicySnapshot>;
  if (typeof candidate.version !== "string" || !Array.isArray(candidate.tiers)) return null;

  const tiers = candidate.tiers.filter(
    (t): t is CancellationPolicyTier =>
      !!t &&
      typeof t === "object" &&
      typeof (t as CancellationPolicyTier).id === "string" &&
      typeof (t as CancellationPolicyTier).feePercent === "number" &&
      Number.isFinite((t as CancellationPolicyTier).feePercent) &&
      (t as CancellationPolicyTier).feePercent >= 0 &&
      (t as CancellationPolicyTier).feePercent <= 100 &&
      typeof (t as CancellationPolicyTier).message === "string" &&
      ((t as CancellationPolicyTier).minHoursBefore === null ||
        typeof (t as CancellationPolicyTier).minHoursBefore === "number"),
  );
  // A policy with no time tier cannot answer "how late is this cancellation", which is the only
  // question it exists to answer.
  if (!tiers.some((t) => t.minHoursBefore !== null)) return null;
  return { version: candidate.version, tiers };
}
