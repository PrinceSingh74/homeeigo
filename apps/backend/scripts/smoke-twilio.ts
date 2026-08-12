/**
 * Verify Twilio SMS path is live.
 *   bun run scripts/smoke-twilio.ts [E.164 phone, e.g. +919876543210]
 */
import "../src/load-env";
import { OTPService } from "../src/services/otp.service";
import prisma from "../src/lib/prisma";

const phone = process.argv[2] || process.env.SMOKE_OTP_PHONE;
if (!phone) {
  console.error("Usage: bun run scripts/smoke-twilio.ts +91XXXXXXXXXX");
  console.error("Or set SMOKE_OTP_PHONE in .env");
  process.exit(1);
}

const otp = new OTPService(prisma);
const result = await otp.sendOTP(phone);
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
process.exit(result.success ? 0 : 1);
