/**
 * P3-8 — regression for `toInputJsonObject`, added to fix TS2322 on the AI-brain memory route
 * (`Record<string, unknown>` is not assignable to `Prisma.InputJsonObject`).
 *
 * The point of the helper is that the mismatch is REAL, not a compiler technicality: `unknown`
 * admits values Postgres cannot store. Casting would have moved the failure from a 400 at the
 * edge to a 500 at the write. These cases are exactly the values a cast would have let through.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { toInputJsonObject } from "../lib/json-input";

describe("P3-8 — accepts what the database can actually store", () => {
  test("plain nested JSON survives unchanged", () => {
    const input = { a: 1, b: "two", c: null, d: [1, "x", { e: true }], f: { g: { h: 0 } } };
    expect(toInputJsonObject(input)).toEqual(input);
  });

  test("an empty object is valid", () => {
    expect(toInputJsonObject({})).toEqual({});
  });
});

describe("P3-8 — rejects what a cast would have let reach the write", () => {
  /**
   * CORRECTED. The original list here asserted that `undefined`, functions, symbols, `Date`, `Map`
   * and NaN were all rejected. That encoded a belief about serialisation rather than a fact about
   * it, and it was wrong in a way that mattered: Prisma serialises a `Date` to an ISO string and
   * drops `undefined` properties, so rejecting them broke the transactional outbox for real domain
   * events (`time: new Date()`, optional correlation ids) — caught by
   * `partner-operations.integration`, not by this file.
   *
   * The guard now defers to `JSON.stringify`, which is the conversion the driver actually performs.
   * Only two things genuinely cannot be stored.
   */
  test.each([
    ["bigint value", { a: 10n }],
    ["nested bigint", { a: { b: [{ c: 1n }] } }],
  ])("rejects %s — serialisation throws on it", (_label, value) => {
    expect(toInputJsonObject(value)).toBeNull();
  });

  test.each([
    ["Date (serialised to an ISO string)", { a: new Date() }],
    ["undefined property (dropped)", { a: undefined }],
    ["function property (dropped)", { a: () => 1 }],
    ["symbol property (dropped)", { a: Symbol("s") }],
    ["NaN (stored as null)", { a: NaN }],
    ["a real domain-event shape", { id: "e1", time: new Date(), homigo: { correlationId: undefined } }],
  ])("accepts %s — the database takes it", (_label, value) => {
    expect(toInputJsonObject(value)).not.toBeNull();
  });

  test("rejects a cyclic object instead of throwing at the write", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(toInputJsonObject(cyclic)).toBeNull();
  });

  test.each([
    ["null", null],
    ["an array", [1, 2]],
    ["a string", "text"],
    ["a number", 5],
  ])("rejects %s — a Json OBJECT is required", (_label, value) => {
    expect(toInputJsonObject(value)).toBeNull();
  });
});

describe("P3-8 — the memory route validates instead of asserting", () => {
  let code = "";
  beforeAll(async () => {
    const file = Bun.file(`${import.meta.dir}/../routes/ai-brain.routes.ts`);
    // Strip comments first: the assertions below are about CODE, and the fix's own comments
    // quote the very casts they removed.
    code = (await file.text())
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ");
  });

  test("no `as never` casts remain anywhere in the route file", () => {
    // There were six. Each forced an unvalidated string into a real Prisma enum, which is why
    // none of them showed up as a typecheck error until the cast was removed.
    expect(code).not.toContain("as never");
    expect(code).not.toContain("body.content as Record<string, unknown>");
  });

  test("the store path validates its JSON", () => {
    expect(code).toContain("toInputJsonObject(body.content)");
  });

  test("enum-valued inputs are validated by schema, not by cast", () => {
    // memoryType selects the retention TTL and feeds the content-safety screen.
    expect(code).toContain("memoryType: MEMORY_TYPE_SCHEMA");
    expect(code).toContain("type: t.Optional(MEMORY_TYPE_SCHEMA)");
    expect(code).toContain("status: t.Optional(APPROVAL_STATUS_SCHEMA)");
  });

  test("actorRole goes through the security module's mapper", () => {
    // UserRole.VENDOR maps to AiGatewayRole.PARTNER; a cast could force a non-member through.
    expect(code).toContain("actorRole: adminAiRole(role, set)");
    expect(code).toContain("mapUserRoleToAiRole(role, \"admin\")");
  });
});
