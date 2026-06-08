import { PartnerRegistrationSessionStatus } from "@prisma/client";
import jsonwebtoken from "jsonwebtoken";
import prisma from "../lib/prisma";
import { JWT_CONFIG, JWT_SECRETS } from "./jwt.service";

const REGISTRATION_TTL_HOURS = 24;

export type RegistrationSessionContext = {
  sessionId: string;
  userId: string;
  providerId: string | null;
  otpVerified: boolean;
};

export class PartnerRegistrationSessionService {
  private readonly secret = JWT_SECRETS.ACCESS;

  async createOrRefreshAfterOtp(userId: string): Promise<{
    session: RegistrationSessionContext;
    registrationToken: string;
  }> {
    const expiresAt = new Date(Date.now() + REGISTRATION_TTL_HOURS * 60 * 60 * 1000);

    const session = await prisma.partnerRegistrationSession.upsert({
      where: { userId },
      create: {
        userId,
        otpVerified: true,
        expiresAt,
        status: PartnerRegistrationSessionStatus.ACTIVE,
      },
      update: {
        otpVerified: true,
        expiresAt,
        status: PartnerRegistrationSessionStatus.ACTIVE,
      },
    });

    const ctx: RegistrationSessionContext = {
      sessionId: session.id,
      userId: session.userId,
      providerId: session.providerId,
      otpVerified: session.otpVerified,
    };

    return {
      session: ctx,
      registrationToken: this.issueToken(ctx, expiresAt),
    };
  }

  issueToken(ctx: RegistrationSessionContext, expiresAt: Date): string {
    const now = Math.floor(Date.now() / 1000);
    return jsonwebtoken.sign(
      {
        type: "registration",
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        providerId: ctx.providerId,
        iat: now,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.secret,
      { algorithm: JWT_CONFIG.ALGORITHM },
    );
  }

  verifyToken(token: string): RegistrationSessionContext | null {
    try {
      const decoded = jsonwebtoken.verify(token.replace(/^Bearer\s+/i, ""), this.secret, {
        algorithms: [JWT_CONFIG.ALGORITHM],
      }) as {
        type?: string;
        sessionId?: string;
        userId?: string;
        providerId?: string | null;
      };
      if (decoded.type !== "registration" || !decoded.sessionId || !decoded.userId) return null;
      return {
        sessionId: decoded.sessionId,
        userId: decoded.userId,
        providerId: decoded.providerId ?? null,
        otpVerified: true,
      };
    } catch {
      return null;
    }
  }

  async resolveSession(token: string): Promise<RegistrationSessionContext> {
    const decoded = this.verifyToken(token);
    if (!decoded) throw new Error("FORBIDDEN:Invalid or expired registration token");

    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { id: decoded.sessionId },
    });
    if (!session) throw new Error("FORBIDDEN:Registration session not found");
    if (session.status !== PartnerRegistrationSessionStatus.ACTIVE) {
      throw new Error("FORBIDDEN:Registration session is no longer active");
    }
    if (session.expiresAt < new Date()) {
      await prisma.partnerRegistrationSession.update({
        where: { id: session.id },
        data: { status: PartnerRegistrationSessionStatus.EXPIRED },
      });
      throw new Error("FORBIDDEN:Registration session expired");
    }
    if (!session.otpVerified) throw new Error("FORBIDDEN:OTP verification required");
    if (session.userId !== decoded.userId) throw new Error("FORBIDDEN:Session user mismatch");

    return {
      sessionId: session.id,
      userId: session.userId,
      providerId: session.providerId,
      otpVerified: session.otpVerified,
    };
  }

  async bindProvider(sessionId: string, userId: string, providerId: string): Promise<RegistrationSessionContext> {
    const session = await prisma.partnerRegistrationSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new Error("FORBIDDEN:Invalid registration session");

    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider || provider.userId !== userId) throw new Error("FORBIDDEN:Provider ownership mismatch");

    const updated = await prisma.partnerRegistrationSession.update({
      where: { id: sessionId },
      data: { providerId },
    });

    return {
      sessionId: updated.id,
      userId: updated.userId,
      providerId: updated.providerId,
      otpVerified: updated.otpVerified,
    };
  }

  async assertProviderOwnership(session: RegistrationSessionContext, targetProviderId: string): Promise<void> {
    if (!session.providerId || session.providerId !== targetProviderId) {
      throw new Error("FORBIDDEN:You do not own this provider registration");
    }
    const provider = await prisma.provider.findUnique({ where: { id: targetProviderId } });
    if (!provider || provider.userId !== session.userId) {
      throw new Error("FORBIDDEN:You do not own this provider registration");
    }
  }

  async requireProviderId(session: RegistrationSessionContext): Promise<string> {
    if (!session.providerId) throw new Error("FORBIDDEN:Complete services step before continuing");
    await this.assertProviderOwnership(session, session.providerId);
    return session.providerId;
  }

  async completeSession(sessionId: string): Promise<void> {
    await prisma.partnerRegistrationSession.update({
      where: { id: sessionId },
      data: { status: PartnerRegistrationSessionStatus.COMPLETED },
    });
  }

  reissueToken(session: RegistrationSessionContext, expiresAt: Date): string {
    return this.issueToken(session, expiresAt);
  }
}

export const partnerRegistrationSessionService = new PartnerRegistrationSessionService();
