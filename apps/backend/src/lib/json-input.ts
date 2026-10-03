import type { Prisma } from "@prisma/client";

/**
 * Narrows an untrusted value to something Prisma can actually store in a Json column.
 *
 * `Record<string, unknown>` is NOT assignable to `Prisma.InputJsonObject`, and the difference is
 * real rather than pedantic: `unknown` admits values Postgres cannot represent — `undefined`,
 * functions, symbols, `BigInt`, `NaN`/`Infinity`, and cyclic objects. Casting past the mismatch
 * (`as Prisma.InputJsonObject`, `as never`) makes the compiler agree while leaving the failure to
 * surface at the database as a 500.
 *
 * So this VALIDATES instead of asserting, and returns `null` when the value is not storable, which
 * lets a route answer 400 for bad input rather than crashing on write.
 */
export function toInputJsonObject(value: unknown): Prisma.InputJsonObject | null {
  if (!isPlainObject(value)) return null;
  return isJsonSafe(value, new WeakSet()) ? (value as Prisma.InputJsonObject) : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Can this value actually be written to a Json column?
 *
 * Defined by what serialisation ACTUALLY does, not by a hand-written list of allowed types. The
 * first version of this guard enumerated types and rejected `Date` and `undefined` — and that was
 * wrong in a way that only a real payload revealed: Prisma serialises a `Date` to an ISO string and
 * drops `undefined` properties, so both are perfectly storable. Rejecting them broke the
 * transactional outbox for real domain events, which carry `time: new Date()` and optional
 * correlation ids (caught by `partner-operations.integration`).
 *
 * `JSON.stringify` is the authority here because it is the same conversion the driver performs. It
 * throws on exactly the two things that genuinely cannot be stored — BigInt and circular
 * references — and quietly handles everything else the way the database will.
 */
function isJsonSafe(value: unknown, _seen: WeakSet<object>): boolean {
  // Bun's JSON.stringify accepts BigInt in some versions; Prisma/Postgres still cannot store it.
  if (containsBigInt(value, new WeakSet())) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    // TypeError: circular structure (or other non-JSON values).
    return false;
  }
}

function containsBigInt(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === "bigint") return true;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsBigInt(item, seen));
  return Object.values(value).some((item) => containsBigInt(item, seen));
}

/**
 * Array counterpart of {@link toInputJsonObject}, for Prisma Json columns holding a list.
 *
 * Same reasoning: a typed `T[]` is not assignable to `Prisma.InputJsonArray`, and the difference is
 * real — an element carrying `undefined`, a Date, or a class instance cannot be stored. Returns
 * `null` rather than throwing so a best-effort writer can skip the row instead of failing.
 */
export function toInputJsonArray(value: unknown): Prisma.InputJsonArray | null {
  if (!Array.isArray(value)) return null;
  return isJsonSafe(value, new WeakSet()) ? (value as Prisma.InputJsonArray) : null;
}
