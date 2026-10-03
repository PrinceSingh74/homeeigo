/**
 * Phase 11 — exact candidate-pool parity for the legacy → typed capability backfill.
 *
 * PURE: no database, no environment. The backfill script and the live closure verifier both feed it
 * rows they read, so "what the backfill may insert" and "what the verifier accepts" are one rule.
 *
 * The pool that must be preserved is TODAY'S EFFECTIVE pool, which is not the legacy String[] rule:
 * in LEGACY_FALLBACK (`evaluateCapabilityGates`) a provider with NO typed row at all is judged by the
 * legacy rule, while a provider WITH any typed row is judged by its ACTIVE typed rows only. So the
 * backfill may only insert for providers that have zero typed rows — inserting a legacy-derived row
 * for a provider whose typed rows are already authoritative would GROW the pool (grant a service the
 * platform does not offer through them today).
 */
export type ParityRow = { serviceId: string; status: string; origin: string | null };
export type ParityProvider = { id: string; serviceCategories: string[]; origin: string | null; rows: ParityRow[] };
export type ParityService = { id: string; slug: string; offers: (serviceCategories: string[]) => boolean };
export type PoolPair = { providerId: string; serviceId: string };

export type ParityReport = {
  services: number;
  providers: number;
  /** Rows the backfill inserts: legacy-offered pairs of providers that have no typed row at all. */
  toInsert: Array<PoolPair & { origin: string | null }>;
  /** Pairs the legacy string names but typed rows (already authoritative) do not grant. Never inserted. */
  legacyNotGranted: PoolPair[];
  /** Typed rows whose provenance population differs from their provider's: invisible to the gate. */
  invisibleRows: PoolPair[];
  perService: Array<{ slug: string; serviceId: string; before: string[]; after: string[]; shrink: string[]; growth: string[] }>;
  shrink: PoolPair[];
  growth: PoolPair[];
  exact: boolean;
};

const key = (p: string, s: string) => `${p}|${s}`;

/**
 * A typed row counts only when it sits in the same population as its provider (the gate's
 * `rowVisible`); a row with UNKNOWN provenance inherits its provider's population.
 */
function rowInPopulation(r: ParityRow, p: ParityProvider, isBusiness: (o: string | null) => boolean): boolean {
  return isBusiness(r.origin ?? p.origin) === isBusiness(p.origin);
}
function activeVisible(p: ParityProvider, serviceId: string, isBusiness: (o: string | null) => boolean): boolean {
  return p.rows.some((r) => r.serviceId === serviceId && r.status === "ACTIVE" && rowInPopulation(r, p, isBusiness));
}

/** Eligibility under LEGACY_FALLBACK — what matching does today. */
export function effectiveToday(p: ParityProvider, s: ParityService, isBusiness: (o: string | null) => boolean): boolean {
  if (activeVisible(p, s.id, isBusiness)) return true;
  return p.rows.length === 0 && s.offers(p.serviceCategories);
}

export function computeParity(
  providers: ParityProvider[],
  services: ParityService[],
  isBusiness: (o: string | null) => boolean,
  opts: { alreadyInserted?: boolean } = {},
): ParityReport {
  const toInsert: ParityReport["toInsert"] = [];
  const legacyNotGranted: PoolPair[] = [];
  const invisibleRows: PoolPair[] = [];
  const perService: ParityReport["perService"] = [];
  const shrink: PoolPair[] = [];
  const growth: PoolPair[] = [];

  for (const p of providers) {
    for (const r of p.rows) if (!rowInPopulation(r, p, isBusiness)) invisibleRows.push({ providerId: p.id, serviceId: r.serviceId });
  }
  const inserted = new Set<string>();
  for (const s of services) {
    const before: string[] = [];
    const after: string[] = [];
    for (const p of providers) {
      const legacy = s.offers(p.serviceCategories);
      const active = activeVisible(p, s.id, isBusiness);
      const today = active || (p.rows.length === 0 && legacy);
      if (p.rows.length === 0 && legacy && !opts.alreadyInserted) {
        toInsert.push({ providerId: p.id, serviceId: s.id, origin: p.origin });
        inserted.add(key(p.id, s.id));
      }
      if (p.rows.length > 0 && legacy && !active) legacyNotGranted.push({ providerId: p.id, serviceId: s.id });
      const strict = active || inserted.has(key(p.id, s.id));
      if (today) before.push(p.id);
      if (strict) after.push(p.id);
      if (today && !strict) shrink.push({ providerId: p.id, serviceId: s.id });
      if (!today && strict) growth.push({ providerId: p.id, serviceId: s.id });
    }
    before.sort();
    after.sort();
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    perService.push({
      slug: s.slug,
      serviceId: s.id,
      before,
      after,
      shrink: before.filter((id) => !afterSet.has(id)),
      growth: after.filter((id) => !beforeSet.has(id)),
    });
  }
  return { services: services.length, providers: providers.length, toInsert, legacyNotGranted, invisibleRows, perService, shrink, growth, exact: shrink.length === 0 && growth.length === 0 };
}

/** Pool comparison against a recorded baseline (service id → sorted provider ids). Zero tolerance both ways. */
export function comparePools(
  baseline: Record<string, string[]>,
  current: Record<string, string[]>,
): { shrink: PoolPair[]; growth: PoolPair[]; missingServices: string[]; extraServices: string[]; exact: boolean } {
  const shrink: PoolPair[] = [];
  const growth: PoolPair[] = [];
  const missingServices = Object.keys(baseline).filter((s) => !(s in current));
  const extraServices = Object.keys(current).filter((s) => !(s in baseline));
  for (const [serviceId, was] of Object.entries(baseline)) {
    const now = new Set(current[serviceId] ?? []);
    const old = new Set(was);
    for (const id of was) if (!now.has(id)) shrink.push({ providerId: id, serviceId });
    for (const id of now) if (!old.has(id)) growth.push({ providerId: id, serviceId });
  }
  for (const s of extraServices) for (const id of current[s]!) growth.push({ providerId: id, serviceId: s });
  return { shrink, growth, missingServices, extraServices, exact: !shrink.length && !growth.length && !missingServices.length && !extraServices.length };
}

/** Strict-mode pool straight from typed rows: an ACTIVE row in the provider's own population. */
export function strictPools(providers: ParityProvider[], services: ParityService[], isBusiness: (o: string | null) => boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of services) out[s.id] = providers.filter((p) => activeVisible(p, s.id, isBusiness)).map((p) => p.id).sort();
  return out;
}

/** Today's pool (LEGACY_FALLBACK semantics) as the baseline a later strict pool must reproduce. */
export function effectivePools(providers: ParityProvider[], services: ParityService[], isBusiness: (o: string | null) => boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of services) out[s.id] = providers.filter((p) => effectiveToday(p, s, isBusiness)).map((p) => p.id).sort();
  return out;
}
