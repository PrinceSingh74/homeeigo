/**
 * Partner OS finance axis. Wallet balances stay numeric; this machine is the
 * state of a unit of partner money from earning post through payout.
 *
 * Job COMPLETED may *gate* EARNING_POSTED. COMPLETED is never a finance state.
 * Availability AVAILABLE is never a finance state.
 */
import {
  FINANCE_STATES,
  PARTNER_AXIS,
  assertBelongsToAxis,
  type PartnerFinanceState,
} from "./partner-four-axis";

export { FINANCE_STATES };
export type { PartnerFinanceState };

const TRANSITIONS: Record<PartnerFinanceState, PartnerFinanceState[]> = {
  EARNING_POSTED: ["PENDING", "AVAILABLE"],
  PENDING: ["AVAILABLE"],
  AVAILABLE: ["WITHDRAWAL_REQUESTED"],
  WITHDRAWAL_REQUESTED: ["PROCESSING", "AVAILABLE"],
  PROCESSING: ["PAID", "AVAILABLE"],
  PAID: [],
};

export function canTransitionFinance(from: PartnerFinanceState, to: PartnerFinanceState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertFinanceTransition(from: PartnerFinanceState, to: PartnerFinanceState): void {
  assertBelongsToAxis(PARTNER_AXIS.FINANCE, from);
  assertBelongsToAxis(PARTNER_AXIS.FINANCE, to);
  if (!canTransitionFinance(from, to)) {
    const err = new Error(`INVALID_TRANSITION:Cannot move finance from ${from} to ${to}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function getAllowedFinanceTransitions(from: PartnerFinanceState): PartnerFinanceState[] {
  return TRANSITIONS[from] ?? [];
}

export type FinancePhaseInput = {
  earningExists: boolean;
  settlementStatus?: string | null;
  availableBalance?: number;
  reservedBalance?: number;
  withdrawalStatus?: string | null;
};

/**
 * Project earning + wallet + withdrawal rows onto the finance axis.
 * A completed withdrawal is PAID; a failed/cancelled one returns money to AVAILABLE.
 */
export function deriveFinanceState(input: FinancePhaseInput): PartnerFinanceState | null {
  const withdrawal = String(input.withdrawalStatus ?? "").toUpperCase();
  if (withdrawal === "COMPLETED") return "PAID";
  if (withdrawal === "PROCESSING") return "PROCESSING";
  if (withdrawal === "REQUESTED" || withdrawal === "APPROVED") return "WITHDRAWAL_REQUESTED";
  if (withdrawal === "FAILED" || withdrawal === "CANCELLED" || withdrawal === "REVERSED") {
    return "AVAILABLE";
  }

  if ((input.reservedBalance ?? 0) > 0) return "WITHDRAWAL_REQUESTED";

  const settlement = String(input.settlementStatus ?? "").toUpperCase();
  if (settlement === "REVERSED") return null;
  if (input.earningExists && settlement !== "CREDITED") return "EARNING_POSTED";
  if (input.earningExists && settlement === "CREDITED" && (input.availableBalance ?? 0) <= 0) {
    return "PENDING";
  }
  if (input.earningExists || (input.availableBalance ?? 0) > 0) return "AVAILABLE";
  return null;
}
