import type { PrismaClient } from "@prisma/client";
import https from "https";
import jsonwebtoken from "jsonwebtoken";
import { generateReferralCode } from "../lib/oauth-signup-fraud";
import { assertUserMayAuthenticate } from "../lib/user-auth-guard";
import { partnerRegistrationService } from "./partner-registration.service";
import { resolveAppleAccountEmail } from "../lib/apple-identity";
import { verifyAppleIdToken } from "../lib/apple-id-token";
import { JWTService } from "./jwt.service";
import { RefreshTokenService } from "./refresh-token.service";

export class AppleOAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService,
    private readonly refreshTokenService: RefreshTokenService
  ) {}

  private generateClientSecret() {
    const teamId = process.env.APPLE_TEAM_ID || "";
    const clientId = process.env.APPLE_CLIENT_ID || "";
    const keyId = process.env.APPLE_KEY_ID || "";
    const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n") || "";
    const now = Math.floor(Date.now() / 1000);
    return jsonwebtoken.sign(
      { iss: teamId, iat: now, exp: now + 15 * 60, aud: "https://appleid.apple.com", sub: clientId },
      privateKey,
      { algorithm: "ES256", keyid: keyId }
    );
  }

  /**
   * @param mode "query" for SPA redirect (web/customer-web flow with GET params),
   *             "form_post" for server-handled POST callback (mobile/native flow).
   *             Apple requires form_post when "name email" scope is requested.
   *             When using query mode we drop the name scope (Apple still returns email in the id_token).
   */
  getAuthorizationUrl(state?: string, mode: "query" | "form_post" = "query"): string {
    const clientId = process.env.APPLE_CLIENT_ID || "";
    const redirect = encodeURIComponent(process.env.APPLE_REDIRECT_URI || "");
    const s = encodeURIComponent(state ?? "");
    const scopes = encodeURIComponent(mode === "form_post" ? "name email" : "email");
    return `https://appleid.apple.com/auth/authorize?response_type=code&response_mode=${mode}&client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${redirect}&scope=${scopes}&state=${s}`;
  }

  async exchangeCodeForToken(code: string): Promise<{ idToken?: string; error?: string }> {
    return new Promise((resolve) => {
      const redirectUri = process.env.APPLE_REDIRECT_URI || "";
      const postData = new URLSearchParams({
        client_id: process.env.APPLE_CLIENT_ID || "",
        client_secret: this.generateClientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString();

      const req = https.request(
        {
          hostname: "appleid.apple.com",
          port: 443,
          path: "/auth/token",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              resolve({ idToken: parsed.id_token, error: parsed.error });
            } catch {
              resolve({ error: "Failed to parse Apple token response" });
            }
          });
        }
      );
      req.on("error", (error) => resolve({ error: error.message }));
      req.write(postData);
      req.end();
    });
  }

  async processCallback(payload: {
    code: string;
    user?: { email?: string; name?: { firstName?: string; lastName?: string } };
    meta?: { deviceId?: string; userAgent?: string; ipAddress?: string };
  }) {
    const tokenResult = await this.exchangeCodeForToken(payload.code);
    if (!tokenResult.idToken) throw new Error(tokenResult.error || "Apple token exchange failed");

    const decoded = await verifyAppleIdToken(tokenResult.idToken);
    const email = resolveAppleAccountEmail(decoded);

    let user = await this.prisma.user.findUnique({ where: { email } });
    let isNewUser = false;
    const firstName = payload.user?.name?.firstName || "Apple";
    if (!user) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          email,
          phoneNumber: `apple_${decoded?.sub || Date.now()}`,
          firstName,
          lastName: payload.user?.name?.lastName || "User",
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          password: "",
          referralCode: generateReferralCode(firstName),
        },
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
      deviceId: payload.meta?.deviceId,
      userAgent: payload.meta?.userAgent,
      ipAddress: payload.meta?.ipAddress,
      deviceName: "Apple OAuth",
    });

    return { user, accessToken, refreshToken, isNewUser };
  }
}
