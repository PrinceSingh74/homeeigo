import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { orderedDispatchTargets } from "../services/assignment-engine.service";

/**
 * 5A adversarial cover for the batched dispatch candidate lookup.
 *
 * `dispatchToNextProvider` used to hydrate one full provider+user row per candidate to read two
 * strings. It now issues a single `findMany` and drives the offer loop off a Map. Batching a lookup
 * is only safe if three things hold, and none of them is obvious from reading the diff:
 *
 *   1. an empty candidate list must not become "match everything" or throw;
 *   2. a candidate whose provider row has vanished must still be SKIPPED, not offered with a
 *      half-built object — the `continue` has to keep the meaning null `findUnique` gave it;
 *   3. the offer order must come from the candidate list, not from the query. `WHERE id IN (...)`
 *      has no ORDER BY, so Postgres may return rows in any order. Dispatch puts customer-pinned
 *      partners first and records `offeredProviderIds[0]` as the booking's current provider, so
 *      iterating the query result instead of the candidates would silently unpin them.
 *
 * These assert the lookup shape the service uses against the real database, so a future refactor
 * that iterates the query result, or drops the null guard, fails here.
 */
const RUN = `dispatch-batch-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

/** The exact lookup `dispatchToNextProvider` performs. */
async function batchedLookup(candidateIds: string[]) {
  const rows = await prisma.provider.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, userId: true },
  });
  return new Map(rows.map((p) => [p.id, p]));
}

describe("dispatch candidate batching", () => {
  test("an empty candidate list selects nothing — it must not degrade into an unfiltered read", async () => {
    if (!dbOk) return;
    const map = await batchedLookup([]);
    expect(map.size).toBe(0);
  });

  test("a candidate with no provider row is absent from the map, so the loop skips it", async () => {
    if (!dbOk) return;
    const ghost = `prov-does-not-exist-${RUN}`;
    const map = await batchedLookup([ctx.providerId, ghost]);

    expect(map.has(ghost)).toBe(false);
    expect(map.get(ctx.providerId)?.userId).toBe(ctx.vendorUserId);

    // What the offer loop does with that map: the ghost is dropped, the real candidate survives.
    const offered = [ctx.providerId, ghost].filter((id) => map.has(id));
    expect(offered).toEqual([ctx.providerId]);
  });

  test("the batch returns the same (id, userId) pair findUnique returned — no field is lost", async () => {
    if (!dbOk) return;
    const single = await prisma.provider.findUnique({ where: { id: ctx.providerId } });
    const map = await batchedLookup([ctx.providerId]);
    expect(map.get(ctx.providerId)).toEqual({ id: single!.id, userId: single!.userId });
  });

  test("offer order follows the candidate list, not the query result — pinned partners stay first", () => {
    // The pairing the dispatch loop iterates. The map is deliberately built in the OPPOSITE order to
    // the candidate list, which is exactly what an unordered `WHERE id IN (...)` is free to return.
    const targets = [{ providerId: "pinned" }, { providerId: "other-a" }, { providerId: "other-b" }];
    const queryResult = [
      { id: "other-b", userId: "u-b" },
      { id: "other-a", userId: "u-a" },
      { id: "pinned", userId: "u-pinned" },
    ];
    const byId = new Map(queryResult.map((p) => [p.id, p]));

    const paired = orderedDispatchTargets(targets, byId);

    // Candidate order, not query order: the pin is still offered first.
    expect(paired.map((p) => p.candidate.providerId)).toEqual(["pinned", "other-a", "other-b"]);
    // And each candidate carries ITS OWN row, not a positionally mismatched one.
    expect(paired.map((p) => p.provider.userId)).toEqual(["u-pinned", "u-a", "u-b"]);
  });

  test("a candidate with no row is dropped without shifting the partners behind it", () => {
    const targets = [{ providerId: "pinned" }, { providerId: "ghost" }, { providerId: "other" }];
    const byId = new Map([
      ["pinned", { id: "pinned", userId: "u-pinned" }],
      ["other", { id: "other", userId: "u-other" }],
    ]);

    const paired = orderedDispatchTargets(targets, byId);

    expect(paired.map((p) => p.candidate.providerId)).toEqual(["pinned", "other"]);
    expect(paired.map((p) => p.provider.userId)).toEqual(["u-pinned", "u-other"]);
  });

  test("an empty candidate list pairs nothing, however many rows the query returned", () => {
    const byId = new Map([["stray", { id: "stray", userId: "u-stray" }]]);
    expect(orderedDispatchTargets([], byId)).toEqual([]);
  });

});
