/**
 * Two processes creating the same encryption-key version resolve to ONE key (2026-10-01).
 *
 * Found by running the suite on a freshly built test database: two processes encrypting for the first
 * time both inserted key version N for a purpose; the loser hit the (purpose, key_version) unique index,
 * the encryption failed, and the customer's address create answered 409 CONFLICT. In production the
 * same happens to two instances on a new database, or rotating at once.
 *
 * Staged deterministically: the "latest version" read is pinned, so all five creators compute the SAME
 * next version — what two processes see when neither has committed. Inserts and the winner lookup go
 * to the real database and its real unique index.
 */
import "../load-env";
import { afterAll, describe, expect, test } from "bun:test";
import prismaBase from "../lib/prisma-base";
import { keyManagementService } from "../services/key-management.service";

const CREATED_BY = "test-key-race";
const purpose = "PAYMENT" as const;

afterAll(async () => {
  // Keys this file created; nothing outside this file encrypts with them in between.
  await prismaBase.encryptionKey.deleteMany({ where: { purpose, createdBy: CREATED_BY } });
});

describe("encryption key creation under concurrency", () => {
  test("5 creators racing for the same version: one key is created and all 5 get it", async () => {
    const latest = await prismaBase.encryptionKey.findFirst({ where: { purpose }, orderBy: { keyVersion: "desc" } });
    const nextVersion = (latest?.keyVersion ?? 0) + 1;
    const staged = {
      encryptionKey: {
        findFirst: (args: { orderBy?: unknown }) =>
          args?.orderBy ? Promise.resolve(latest) : prismaBase.encryptionKey.findFirst(args as never),
        create: (args: unknown) => prismaBase.encryptionKey.create(args as never),
      },
    } as unknown as Parameters<typeof keyManagementService.createKey>[2];

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => keyManagementService.createKey(purpose, CREATED_BY, staged)));

    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.map((r) => String(r.reason?.message ?? r.reason).split("\n").pop())).toEqual([]);
    const keys = (results as PromiseFulfilledResult<{ id: string; keyVersion: number }>[]).map((r) => r.value);
    expect(new Set(keys.map((k) => k.id)).size).toBe(1);
    expect(keys[0]!.keyVersion).toBe(nextVersion);
    expect(await prismaBase.encryptionKey.count({ where: { purpose, keyVersion: nextVersion } })).toBe(1);
  });
});
