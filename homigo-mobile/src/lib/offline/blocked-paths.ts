/**
 * Paths that must NEVER be queued for offline replay. Payment, wallet top-up,
 * verification, refund, settlement, and subscription flows require live connectivity
 * and server-side idempotency — they pause instead of enqueueing.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /^\/api\/payments\b/,
  /^\/api\/wallet\/add-money\b/,
  /^\/api\/wallet\/checkout\b/,
  /^\/api\/wallet\/withdraw\b/,
  /^\/api\/subscriptions\/(order|verify)\b/,
  /^\/api\/finance\/(refund|settlement)\b/,
  /^\/api\/admin\/finance\/(refund|settlement|payout)\b/,
];

export class OfflinePaymentBlockedError extends Error {
  readonly code = "OFFLINE_PAYMENT_BLOCKED" as const;
  constructor(path: string) {
    super(`Payment and wallet mutations cannot be queued offline: ${path}`);
    this.name = "OfflinePaymentBlockedError";
  }
}

export function isOfflineBlockedPath(path: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(path));
}

export function assertOfflineSafePath(path: string): void {
  if (isOfflineBlockedPath(path)) {
    throw new OfflinePaymentBlockedError(path);
  }
}
