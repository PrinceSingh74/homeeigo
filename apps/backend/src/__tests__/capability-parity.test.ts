/**
 * Phase 11 — exact pool parity for the capability backfill (pure; no database).
 * The rule under test: the backfill preserves TODAY'S EFFECTIVE pool, not the legacy string.
 */
import { describe, expect, it } from "bun:test";
import { comparePools, computeParity, effectivePools, strictPools, type ParityProvider, type ParityService } from "../../scripts/lib/capability-parity";

const isBusiness = (o: string | null) => o === null || o === "REAL";
const svc = (id: string, token: string): ParityService => ({ id, slug: id, offers: (c) => c.includes(token) });
const CLEAN = svc("svc-clean", "cleaning");
const PAINT = svc("svc-paint", "painting");
const prov = (id: string, cats: string[], rows: ParityProvider["rows"] = [], origin: string | null = null): ParityProvider => ({ id, serviceCategories: cats, origin, rows });

describe("capability parity", () => {
  it("a provider with no typed rows gets exactly its legacy pairs, and the pool is unchanged", () => {
    const r = computeParity([prov("p1", ["cleaning", "painting"]), prov("p2", ["cleaning"])], [CLEAN, PAINT], isBusiness);
    expect(r.toInsert.map((x) => `${x.providerId}|${x.serviceId}`).sort()).toEqual(["p1|svc-clean", "p1|svc-paint", "p2|svc-clean"]);
    expect(r.exact).toBe(true);
    expect(r.shrink).toEqual([]);
    expect(r.growth).toEqual([]);
  });

  it("a provider whose typed rows are already authoritative is never widened by its legacy string", () => {
    // p1 has one ACTIVE typed row (cleaning). Its legacy string also names painting, which matching
    // does NOT honour today (it has typed rows). Inserting painting would grow the pool.
    const p1 = prov("p1", ["cleaning", "painting"], [{ serviceId: "svc-clean", status: "ACTIVE", origin: null }]);
    const r = computeParity([p1], [CLEAN, PAINT], isBusiness);
    expect(r.toInsert).toEqual([]);
    expect(r.legacyNotGranted).toEqual([{ providerId: "p1", serviceId: "svc-paint" }]);
    expect(r.perService.find((s) => s.slug === "svc-paint")!.after).toEqual([]);
    expect(r.exact).toBe(true);
  });

  it("a REVOKED typed row keeps the provider out, before and after", () => {
    const p1 = prov("p1", ["cleaning"], [{ serviceId: "svc-clean", status: "REVOKED", origin: null }]);
    const r = computeParity([p1], [CLEAN], isBusiness);
    expect(r.toInsert).toEqual([]);
    expect(r.perService[0]!.before).toEqual([]);
    expect(r.perService[0]!.after).toEqual([]);
    expect(r.exact).toBe(true);
  });

  it("a typed row from another population is invisible and reported", () => {
    const p1 = prov("p1", ["cleaning"], [{ serviceId: "svc-clean", status: "ACTIVE", origin: "INFERRED_SYNTHETIC" }], null);
    const r = computeParity([p1], [CLEAN], isBusiness);
    expect(r.invisibleRows).toEqual([{ providerId: "p1", serviceId: "svc-clean" }]);
    expect(r.perService[0]!.before).toEqual([]);
    expect(r.perService[0]!.after).toEqual([]);
  });

  it("a typed row with UNKNOWN provenance belongs to its provider's population (as the gate reads it)", () => {
    const synthetic = prov("p1", ["cleaning", "painting"], [{ serviceId: "svc-clean", status: "ACTIVE", origin: null }], "INFERRED_SYNTHETIC");
    const r = computeParity([synthetic], [CLEAN, PAINT], isBusiness);
    expect(r.invisibleRows).toEqual([]);
    expect(r.perService.find((s) => s.slug === "svc-clean")!.before).toEqual(["p1"]);
    expect(r.perService.find((s) => s.slug === "svc-clean")!.after).toEqual(["p1"]);
    expect(r.legacyNotGranted).toEqual([{ providerId: "p1", serviceId: "svc-paint" }]);
    expect(r.toInsert).toEqual([]);
    expect(r.exact).toBe(true);
  });

  it("the legacy-only rule this replaces would have grown the pool (the defect, pinned)", () => {
    const p1 = prov("p1", ["cleaning", "painting"], [{ serviceId: "svc-clean", status: "ACTIVE", origin: null }]);
    const today = effectivePools([p1], [CLEAN, PAINT], isBusiness);
    // what `after >= legacy` accepted: insert every legacy pair without a typed row
    const widened: ParityProvider = { ...p1, rows: [...p1.rows, { serviceId: "svc-paint", status: "ACTIVE", origin: null }] };
    const cmp = comparePools(today, strictPools([widened], [CLEAN, PAINT], isBusiness));
    expect(cmp.exact).toBe(false);
    expect(cmp.growth).toEqual([{ providerId: "p1", serviceId: "svc-paint" }]);
  });

  it("comparePools reports shrink, growth, and services that appear or vanish", () => {
    const cmp = comparePools({ a: ["p1", "p2"], b: ["p3"] }, { a: ["p1", "p9"], c: ["p4"] });
    expect(cmp.shrink).toEqual([{ providerId: "p2", serviceId: "a" }, { providerId: "p3", serviceId: "b" }]);
    expect(cmp.growth).toEqual([{ providerId: "p9", serviceId: "a" }, { providerId: "p4", serviceId: "c" }]);
    expect(cmp.missingServices).toEqual(["b"]);
    expect(cmp.extraServices).toEqual(["c"]);
    expect(cmp.exact).toBe(false);
  });

  it("after the insert, the strict pool equals the recorded baseline exactly", () => {
    const before = [prov("p1", ["cleaning"]), prov("p2", ["painting"]), prov("p3", ["cleaning"], [{ serviceId: "svc-paint", status: "ACTIVE", origin: null }])];
    const baseline = effectivePools(before, [CLEAN, PAINT], isBusiness);
    const plan = computeParity(before, [CLEAN, PAINT], isBusiness);
    const after = before.map((p) => ({ ...p, rows: [...p.rows, ...plan.toInsert.filter((i) => i.providerId === p.id).map((i) => ({ serviceId: i.serviceId, status: "ACTIVE", origin: i.origin }))] }));
    expect(comparePools(baseline, strictPools(after, [CLEAN, PAINT], isBusiness)).exact).toBe(true);
    // and re-planning on the post-insert state inserts nothing (idempotent)
    expect(computeParity(after, [CLEAN, PAINT], isBusiness).toInsert).toEqual([]);
  });
});
