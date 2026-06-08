import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { generateReferralCode } from "../lib/oauth-signup-fraud";
import { assertUserMayAuthenticate } from "../lib/user-auth-guard";
import { partnerRegistrationService } from "./partner-registration.service";
import { JWTService } from "./jwt.service";
import { RefreshTokenService } from "./refresh-token.service";

export function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${process.env.FRONTEND_URL?.replace(/\/$/, "") || "http://localhost:3001"}/auth/google/callback`
  );
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService,
    private readonly refreshTokenService: RefreshTokenService
  ) {}

  /** Read credentials on each call so .env updates apply after API restart. */
  private getClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: getGoogleRedirectUri(),
    });
  }

  assertConfigured(): void {
    if (!isGoogleOAuthConfigured()) {
      throw new Error(
        "Google Sign-In is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/backend/.env, then restart the API (Ctrl+C, then bun run dev).",
      );
    }
  }

  getAuthorizationUrl(state?: string): string {
    this.assertConfigured();
    return this.getClient().generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      state: state ?? crypto.randomUUID(),
      prompt: "consent",
    });
  }

  async exchangeCodeForToken(code: string): Promise<{ success: boolean; idToken?: string; error?: string }> {
    try {
      const { tokens } = await this.getClient().getToken(code);
      if (!tokens.id_token) return { success: false, error: "No ID token received" };
      return { success: true, idToken: tokens.id_token };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token exchange failed",
      };
    }
  }

  async processCallback(code: string, meta?: { deviceId?: string; userAgent?: string; ipAddress?: string }) {
    const tokenResult = await this.exchangeCodeForToken(code);
    const idToken = tokenResult.idToken;
    if (!tokenResult.success || !idToken) {
      throw new Error(tokenResult.error || "Failed to exchange authorization code");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId?.trim()) {
      throw new Error("Google Sign-In is not configured");
    }

    const ticket = await this.getClient().verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error("Email not provided by Google");

    const firstName = (payload.given_name || "User").toString();
    const lastName = (payload.family_name || "").toString();
    const profileImage = payload.picture || null;
    const email = payload.email.toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { email } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          email,
          phoneNumber: `oauth_${payload.sub}`,
          firstName,
          lastName,
          profileImage,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          password: "",
          referralCode: generateReferralCode(firstName),
        },
      });
    } else if (profileImage && !user.profileImage) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { profileImage },
      });
    }

    await assertUserMayAuthenticate(user.id);
    if (user.role === "VENDOR") {
      const approvalBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
      if (approvalBlock) throw new Error("PARTNER_NOT_APPROVED");
    }

    const accessToken = this.jwtService.generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = await this.refreshTokenService.createRefreshToken({
      userId: user.id,
      deviceId: meta?.deviceId,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
      deviceName: "Google OAuth",
    });

    return { user, accessToken, refreshToken, isNewUser };
  }

  async revokeToken(accessOrRefreshToken: string): Promise<boolean> {
    try {
      await this.getClient().revokeToken(accessOrRefreshToken);
      return true;
    } catch {
      return false;
    }
  }
}
