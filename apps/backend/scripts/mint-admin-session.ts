/**
 * Mint a real DB-backed admin session for Admin HQ presence roster E2E.
 *   bun --env-file=.env.test run scripts/mint-admin-session.ts            (local, isolated stack)
 *   bun --env-file=.env run scripts/mint-admin-session.ts --allow-live    (CI's throwaway homigo_db only)
 *
 * Declared target (scripts/lib/script-target.ts): refuses any non-test database unless `--allow-live`
 * is on the command line. The roster spec launched this with a hard-coded `--env-file=.env`, so a
 * local E2E run minted admin sessions in the live database — the same defect as the partner-web
 * mint (X-80).
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { RefreshTokenService } from "../src/services/refresh-token.service";
import { JWTService } from "../src/services/jwt.service";
import { requireDeclaredTarget } from "./lib/script-target";

async function main() {
  requireDeclaredTarget({ label: "mint-admin-session" });
  const deviceId = `admin-roster-${Date.now().toString(36)}`;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isBanned: false, isActive: true },
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
    orderBy: { updatedAt: "desc" },
  });
  if (!admin) {
    console.error(JSON.stringify({ error: "no ADMIN user" }));
    process.exit(2);
  }
  const tokens = await new RefreshTokenService(prisma, new JWTService()).createSessionTokens({
    userId: admin.id,
    email: `admin-proof+${admin.id.slice(-8)}@homigo.local`,
    deviceId,
    deviceName: "Admin roster forensic",
  });
  process.stdout.write(
    `${JSON.stringify({
      deviceId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      user: {
        id: admin.id,
        email: `admin-proof+${admin.id.slice(-8)}@homigo.local`,
        phoneNumber: admin.phoneNumber,
        firstName: admin.firstName,
        lastName: admin.lastName,
        profileImage: admin.profileImage,
        role: admin.role,
        isEmailVerified: admin.isEmailVerified,
        isPhoneVerified: admin.isPhoneVerified,
      },
    })}\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
