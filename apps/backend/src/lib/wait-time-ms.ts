/** Persist millisecond durations on Booking.waitTimeMs / estimatedWaitTimeMs (BIGINT). */
export function toWaitTimeMsBigInt(ms: number | null | undefined): bigint | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return BigInt(Math.max(0, Math.round(ms)));
}

/** Read millisecond durations from BIGINT columns for JS math / JSON APIs. */
export function fromWaitTimeMsBigInt(ms: bigint | number | null | undefined): number | null {
  if (ms == null) return null;
  return typeof ms === "bigint" ? Number(ms) : ms;
}
