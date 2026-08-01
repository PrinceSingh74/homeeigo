/** Authoritative money storage — integer paise eliminates float drift. */

export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

export function addPaise(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Dual-write: keep Float in sync during migration (Phase A). */
export function paiseAndFloat(paise: bigint): { paise: bigint; float: number } {
  return { paise, float: paiseToRupees(paise) };
}
