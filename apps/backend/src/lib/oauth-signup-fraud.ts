import { FraudEventType } from "@prisma/client";
import crypto from "crypto";
import prisma from "./prisma";
import type { FraudContext } from "./fraud-context";
import { fraudContextFromRequest } from "./fraud-context";
import { fraudSignalService } from "../services/fraud-signal.service";
import { referralService } from "../services/referral.service";
import { consentService } from "../services/consent.service";

export type OAuthFraudBody = {
  deviceId?: string;
  browserFingerprint?: string;
  deviceFingerprint?: string;
  timezone?: string;
  referralCode?: string;
};

export function generateReferralCode(firstName: string): string {
  const prefix =
    (firstName || "HM").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase() || "HM";
  return `${prefix}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function fraudContextForOAuth(
  request: Request,
  userId: string,
  body: OAuthFraudBody,
): FraudContext {
  return fraudContextFromRequest(request, userId, {
    deviceId: body.deviceId,
    browserFingerprint: body.browserFingerprint,
    deviceFingerprint: body.deviceFingerprint,
    timezone: body.timezone,
  });
}

/** Capture signup signals and apply referral for brand-new OAuth users. */
export async function handleNewOAuthUser(
  userId: string,
  fraudCtx: FraudContext,
  referralCode?: string,
): Promise<void> {
  void fraudSignalService
    .capture(FraudEventType.SIGNUP, fraudCtx, { id: userId, type: "user_oauth" })
    .catch(() => {});

  await consentService.recordSignupConsents(userId, {
    ipAddress: fraudCtx.ipAddress,
    userAgent: fraudCtx.userAgent,
  });

  const code = referralCode?.trim().toUpperCase();
  if (!code) return;

  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (!referrer || referrer.id === userId) return;

  await prisma.user.update({ where: { id: userId }, data: { referredBy: referrer.id } });
  await referralService.recordSignup(referrer.id, userId, code, fraudCtx);
}
