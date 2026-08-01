export type CancellationActor = "user" | "provider";

export type CancellationTier =
  | "free"
  | "standard"
  | "late"
  | "very_late"
  | "in_progress"
  | "provider_cancel";

export interface CancellationQuote {
  paidAmount: number;
  feeAmount: number;
  feePercent: number;
  refundAmount: number;
  tier: CancellationTier;
  message: string;
  refundMethodHint: "wallet_instant" | "gateway_5_7_days";
}

export interface CancellationPolicyTier {
  id: CancellationTier;
  label: string;
  window: string;
  feePercent: number;
  refundPercent: number;
}

/** Public policy tiers — shown at checkout and in support docs. */
export const CANCELLATION_POLICY_TIERS: CancellationPolicyTier[] = [
  {
    id: "free",
    label: "Free cancellation",
    window: "More than 24 hours before service",
    feePercent: 0,
    refundPercent: 100,
  },
  {
    id: "standard",
    label: "Standard window",
    window: "2–24 hours before service",
    feePercent: 10,
    refundPercent: 90,
  },
  {
    id: "late",
    label: "Late cancellation",
    window: "Under 2 hours before service",
    feePercent: 25,
    refundPercent: 75,
  },
  {
    id: "in_progress",
    label: "Service started",
    window: "While professional is on-site (customer cancel)",
    feePercent: 50,
    refundPercent: 50,
  },
];

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
    paymentMethod?: string | null;
    now?: Date;
  }): CancellationQuote {
    const now = opts.now ?? new Date();
    const paid = round2(Math.max(0, opts.paidAmount));
    const isWallet = (opts.paymentMethod ?? "").toLowerCase() === "wallet";

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
      };
    }

    if (opts.bookingStatus === "IN_PROGRESS") {
      const feePercent = 50;
      const refundAmount = round2(paid * 0.5);
      return {
        paidAmount: paid,
        feeAmount: round2(paid - refundAmount),
        feePercent,
        refundAmount,
        tier: "in_progress",
        message: "50% refund — service was already in progress.",
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
      };
    }

    const hours = hoursUntil(opts.scheduledDate, now);

    if (hours > 24) {
      return {
        paidAmount: paid,
        feeAmount: 0,
        feePercent: 0,
        refundAmount: paid,
        tier: "free",
        message: "Free cancellation — full refund.",
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
      };
    }

    if (hours >= 2) {
      const feePercent = 10;
      const refundAmount = round2(paid * 0.9);
      return {
        paidAmount: paid,
        feeAmount: round2(paid - refundAmount),
        feePercent,
        refundAmount,
        tier: "standard",
        message: "10% cancellation fee applies (2–24 hours before service).",
        refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
      };
    }

    const feePercent = 25;
    const refundAmount = round2(paid * 0.75);
    return {
      paidAmount: paid,
      feeAmount: round2(paid - refundAmount),
      feePercent,
      refundAmount,
      tier: "very_late",
      message: "25% cancellation fee applies (under 2 hours before service).",
      refundMethodHint: isWallet ? "wallet_instant" : "gateway_5_7_days",
    };
  }

  listPublicTiers(): CancellationPolicyTier[] {
    return CANCELLATION_POLICY_TIERS;
  }
}

export const cancellationPolicyService = new CancellationPolicyService();
