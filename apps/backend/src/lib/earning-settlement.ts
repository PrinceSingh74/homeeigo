/**
 * Canonical settlement filter for partner-available earnings.
 *
 * `Earning.paymentStatus` is `EarningSettlementStatus`:
 *   CREDITED — money that settled to the partner. Realised, forecastable, coachable.
 *   REVERSED — clawed back. Must not inflate available totals, forecasts, or per-job averages.
 *
 * Wallet and ledger remain the money movement source of truth. This flag does not replace them
 * and must not be used to invent a third balance. Reads that answer "what can this partner
 * spend / forecast / be coached on" filter CREDITED. Itemised history may still show REVERSED
 * rows with their status.
 */
export const CREDITED_EARNING_WHERE = { paymentStatus: "CREDITED" as const };
