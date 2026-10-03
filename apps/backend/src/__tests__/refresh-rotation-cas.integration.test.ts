/**
 * Concurrent refreshes of ONE refresh token rotate it once (2026-10-01).
 *
 * The revoke-on-rotate was unconditional, so N refreshes that all passed verification all rotated the
 * token and each minted its own live successor. A stolen token raced against the real one therefore
 * kept a branch of the family alive that reuse detection never saw. Now only the caller that flips
 * revokedAt mints; the others receive that same successor.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";
import { RefreshTokenService } from "../services/refresh-token.service";

const service = new RefreshTokenService(prisma, new JWTService());
let userId: string;
let email: string;

beforeAll(async () => {
  const run = `rcas${Date.now().toString(36)}`;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${run}@rotation.test`),
      email: `${run}@rotation.test`,
      phoneNumber: `+9175${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      firstName: "Rotation",
      lastName: "Probe",
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  userId = u.id;
  email = u.email!;
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});

describe("refresh rotation under concurrency", () => {
  it("8 concurrent refreshes of one token mint exactly one successor, handed to every caller", async () => {
    const { refreshToken: t0 } = await service.createSessionTokens({ userId, email });
    const parent = await prisma.refreshToken.findFirstOrThrow({ where: { token: t0 }, select: { id: true, familyId: true } });

    const results = await Promise.all(Array.from({ length: 8 }, () => service.refreshAccessToken({ refreshToken: t0 })));

    const children = await prisma.refreshToken.findMany({ where: { parentTokenId: parent.id }, select: { token: true, revokedAt: true } });
    expect(children.length).toBe(1);
    expect(children[0]!.revokedAt).toBeNull();
    expect(results.map((r) => r.success)).toEqual(Array.from({ length: 8 }, () => true));
    expect(new Set(results.map((r) => r.refreshToken))).toEqual(new Set([children[0]!.token]));
    // Nobody was treated as a reuse attack: the family is intact.
    const liveInFamily = await prisma.refreshToken.count({ where: { familyId: parent.familyId, revokedAt: null } });
    expect(liveInFamily).toBe(1);
  }, 60_000);
});
