/**
 * Cron-friendly cleanup (Part 14): expired refresh sessions + OTP rows.
 * Run: bun run scripts/cleanup-auth.ts
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { OTPService } from "../src/services/otp.service";
import { RefreshTokenService } from "../src/services/refresh-token.service";

const jwt = new JWTService();
const refresh = new RefreshTokenService(prisma, jwt);
const otp = new OTPService(prisma);

const main = async () => {
  const rt = await refresh.deleteExpiredTokens();
  const o1 = await otp.deleteExpiredOTPs();
  const o2 = await otp.deleteOldUsedOTPs();
  console.log(JSON.stringify({ deletedRefreshTokens: rt, deletedExpiredOtps: o1, deletedOldUsedOtps: o2 }));
  await prisma.$disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
