import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { JWTService } from "./jwt.service";
import { RefreshTokenService } from "./refresh-token.service";

export class GoogleOAuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService,
    private readonly refreshTokenService: RefreshTokenService
  ) {
    this.googleClient = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });
  }

  getAuthorizationUrl(state?: string): string {
    return this.googleClient.generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      state: state ?? crypto.randomUUID(),
      prompt: "consent",
    });
  }

  async exchangeCodeForToken(code: string): Promise<{ success: boolean; idToken?: string; error?: string }> {
    try {
      const { tokens } = await this.googleClient.getToken(code);
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

    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error("Email not provided by Google");

    const firstName = (payload.given_name || "User").toString();
    const lastName = (payload.family_name || "").toString();
    const profileImage = payload.picture || null;
    const email = payload.email.toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
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
        },
      });
    } else if (profileImage && !user.profileImage) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { profileImage },
      });
    }

    const accessToken = this.jwtService.generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = await this.refreshTokenService.createRefreshToken({
      userId: user.id,
      deviceId: meta?.deviceId,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
      deviceName: "Google OAuth",
    });

    return { user, accessToken, refreshToken };
  }

  async revokeToken(accessOrRefreshToken: string): Promise<boolean> {
    try {
      await this.googleClient.revokeToken(accessOrRefreshToken);
      return true;
    } catch {
      return false;
    }
  }
}
