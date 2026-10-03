/**
 * Mint a real DB-backed partner session for Partner Web timer forensics.
 * Does not weaken login; uses the same RefreshTokenService as production auth.
 *
 *   bun --env-file=.env.test run scripts/mint-partner-web-session.ts
 *
 * Declared target (scripts/lib/script-target.ts): refuses any non-test database unless `--allow-live`
 * is on the command line. On 2026-09-30 a local E2E run of this script against `.env` minted four
 * live sessions; the partner-web spec now passes `--allow-live` only on a GitHub Actions runner, whose
 * database is the job's own throwaway container.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { RefreshTokenService } from "../src/services/refresh-token.service";
import { JWTService } from "../src/services/jwt.service";
import { requireDeclaredTarget } from "./lib/script-target";

async function main() {
  requireDeclaredTarget({ label: "mint-partner-web-session" });
  const deviceId = `web-timer-${Date.now().toString(36)}`;
  const provider = await prisma.provider.findFirst({
    where: {
      lifecycleState: "ACTIVE",
      isApproved: true,
      isBanned: false,
      isActive: true,
      user: { role: "VENDOR", isBanned: false, isActive: true },
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          profileImage: true,
          isEmailVerified: true,
          isPhoneVerified: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!provider) {
    console.error(JSON.stringify({ error: "no ACTIVE VENDOR provider" }));
    process.exit(2);
  }

  // A minted session is a new device. The last fix another suite left on this partner (section03's
  // live job reports Bengaluru; the timer spec reports Delhi) would make the device's first located
  // beat a ~1,740 km jump: 400 IMPOSSIBLE_JUMP, a quick location-less retry, and a 2 s gap the timer
  // spec reads as a duplicate publisher. Start from an unknown fix — null, not 0,0.
  await prisma.partnerPresence.updateMany({
    where: { providerId: provider.id },
    data: {
      lastLocationAt: null,
      lastLocationReceivedAt: null,
      lastLocationLat: null,
      lastLocationLng: null,
      lastLocationAccuracy: null,
      lastLocationSource: null,
      lastLocationSeq: null,
    },
  });

  const tokens = await new RefreshTokenService(prisma, new JWTService()).createSessionTokens({
    userId: provider.userId,
    email: `timer-proof+${provider.userId.slice(-8)}@homigo.local`,
    deviceId,
    deviceName: "Partner Web timer forensic",
  });

  const payload = {
    providerId: provider.id,
    deviceId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: tokens.sessionId,
    user: {
      id: provider.user.id,
      email: `timer-proof+${provider.userId.slice(-8)}@homigo.local`,
      phoneNumber: provider.user.phoneNumber,
      firstName: provider.user.firstName,
      lastName: provider.user.lastName,
      profileImage: provider.user.profileImage,
      role: provider.user.role,
      isEmailVerified: provider.user.isEmailVerified,
      isPhoneVerified: provider.user.isPhoneVerified,
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
