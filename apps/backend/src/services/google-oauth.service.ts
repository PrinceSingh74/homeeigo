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

/**
 * Redirect URI for the mobile app's sign-in.
 *
 * The app cannot use the web redirect: Google would send the browser to the
 * website, which the phone has no reason to be able to reach, and the app's
 * `homigo://` deep link would never fire. Google also rejects custom schemes for
 * a Web OAuth client. So Google returns to THIS API instead, and
 * `GET /api/auth/google/mobile-callback` bounces the browser into the app.
 *
 * Register this exact URL as an authorised redirect URI on the Google client.
 */
export function getGoogleMobileRedirectUri(): string {
  const base = (process.env.BACKEND_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/google/mobile-callback`;
}

/** Deep link the mobile bridge bounces back to. Scheme must match app.json. */
export function getGoogleAppDeepLink(): string {
  const scheme = process.env.MOBILE_APP_SCHEME?.trim() || "homigo";
  return `${scheme}://auth/google/callback`;
}

/** Google requires the SAME redirect_uri at authorize and at token exchange. */
export function googleRedirectUriFor(platform?: "web" | "mobile"): string {
  return platform === "mobile" ? getGoogleMobileRedirectUri() : getGoogleRedirectUri();
}

export function isGoogleOAuthConfigured(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  // Treat the .env.example placeholders as "not configured" so the app shows a
  // clear setup message instead of bouncing the user to Google's invalid_client
  // error. Real Google client IDs end with .apps.googleusercontent.com and never
  // start with "your-".
  const isPlaceholder = (v: string) => v === "" || v.toLowerCase().startsWith("your-");
  return !isPlaceholder(id) && !isPlaceholder(secret) && id.endsWith(".apps.googleusercontent.com");
}

export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService,
    private readonly refreshTokenService: RefreshTokenService
  ) {}

  /** Read credentials on each call so .env updates apply after API restart. */
  private getClient(redirectUri?: string): OAuth2Client {
    return new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: redirectUri ?? getGoogleRedirectUri(),
    });
  }

  assertConfigured(): void {
    if (!isGoogleOAuthConfigured()) {
      throw new Error(
        "Google Sign-In is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/backend/.env, then restart the API (Ctrl+C, then bun run dev).",
      );
    }
  }

  getAuthorizationUrl(state?: string, redirectUri?: string): string {
    this.assertConfigured();
    return this.getClient(redirectUri).generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      state: state ?? crypto.randomUUID(),
      prompt: "consent",
    });
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri?: string,
  ): Promise<{ success: boolean; idToken?: string; error?: string }> {
    try {
      const { tokens } = await this.getClient(redirectUri).getToken(code);
      if (!tokens.id_token) return { success: false, error: "No ID token received" };
      return { success: true, idToken: tokens.id_token };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token exchange failed",
      };
    }
  }

  async processCallback(
    code: string,
    meta?: { deviceId?: string; userAgent?: string; ipAddress?: string },
    redirectUri?: string,
  ) {
    const tokenResult = await this.exchangeCodeForToken(code, redirectUri);
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

    const { userPiiService } = await import("./user-pii.service");
    let user = await userPiiService.findByEmail(email);
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

    const oauthEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    const { accessToken, refreshToken } = await this.refreshTokenService.createSessionTokens({
      userId: user.id,
      email: oauthEmail ?? email,
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
