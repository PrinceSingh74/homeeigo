import { Elysia, t } from "elysia";
import crypto from "crypto";
import { appendAuthCookies, clearAuthCookies } from "../lib/auth-cookies";
import prisma from "../lib/prisma";
import { consumeRateLimit, isRateLimitExceeded } from "../middleware/rate-limit.middleware";
import { AppleOAuthService } from "../services/apple-oauth.service";
import { GoogleOAuthService } from "../services/google-oauth.service";
import { JWTService } from "../services/jwt.service";
import { OTPService } from "../services/otp.service";
import { PasswordService } from "../services/password.service";
import { RefreshTokenService } from "../services/refresh-token.service";
import { SessionService } from "../services/session.service";

const jwtService = new JWTService();
const refreshTokenService = new RefreshTokenService(prisma, jwtService);
const otpService = new OTPService(prisma);
const googleOAuthService = new GoogleOAuthService(prisma, jwtService, refreshTokenService);
const appleOAuthService = new AppleOAuthService(prisma, jwtService, refreshTokenService);
const sessionService = new SessionService(prisma, refreshTokenService);

/** Prompt Part 14: set `REGISTER_REQUIRE_OTP=false` for local dev without SMS. Default: OTP required. */
const registerOtpRequired = process.env.REGISTER_REQUIRE_OTP !== "false";

const getIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

const requireAuthUser = (request: Request, set: { status?: number | string }) => {
  const header = request.headers.get("authorization");
  const payload = header ? jwtService.verifyAccessToken(header) : null;
  if (!payload?.userId) {
    set.status = 401;
    return null;
  }
  return { userId: payload.userId, email: payload.email };
};

const recordLoginFailure = (ip: string, emailNorm: string, set: { status?: number | string }) => {
  const ipR = consumeRateLimit(`login-fail-ip:${ip}`, 5, 15 * 60 * 1000);
  const emailR = consumeRateLimit(`login-fail-email:${emailNorm}`, 10, 60 * 60 * 1000);
  if (!ipR.allowed || !emailR.allowed) {
    set.status = 429;
    return {
      success: false,
      error: "Too many failed login attempts. Please try again in 15 minutes.",
      code: "RATE_LIMIT_EXCEEDED" as const,
    };
  }
  return null;
};

const oauthPreCheck = (ip: string, set: { status?: number | string }) => {
  if (isRateLimitExceeded(`oauth-fail:${ip}`, 3)) {
    set.status = 429;
    return {
      success: false,
      error: "Too many OAuth callback failures. Try again in one hour.",
      code: "RATE_LIMIT_EXCEEDED" as const,
    };
  }
  const attempts = consumeRateLimit(`oauth-callback-ip:${ip}`, 10, 60 * 60 * 1000);
  if (!attempts.allowed) {
    set.status = 429;
    return { success: false, error: "Too many OAuth attempts", code: "RATE_LIMIT_EXCEEDED" as const };
  }
  return null;
};

const recordOAuthFailure = (ip: string) => {
  consumeRateLimit(`oauth-fail:${ip}`, 3, 60 * 60 * 1000);
};

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    "/register",
    async ({ body, request, set }) => {
      const ip = getIp(request);
      const limiter = consumeRateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
      if (!limiter.allowed) {
        set.status = 429;
        return { success: false, error: "Too many registration attempts", code: "RATE_LIMIT_EXCEEDED" };
      }

      const passwordCheck = PasswordService.validatePasswordStrength(body.password);
      if (!passwordCheck.isValid || PasswordService.isSimilarToUsername(body.password, body.email)) {
        set.status = 400;
        return { success: false, error: "Weak password", code: "INVALID_INPUT", details: passwordCheck.errors };
      }

      if (registerOtpRequired) {
        if (!body.otp) {
          set.status = 400;
          return {
            success: false,
            error:
              "Phone OTP is required (send-otp then include otp here). Set REGISTER_REQUIRE_OTP=false to skip in dev.",
            code: "INVALID_INPUT",
          };
        }
        const otpOk = await otpService.verifyOTP(body.phoneNumber, body.otp);
        if (!otpOk.isValid) {
          set.status = 400;
          return { success: false, error: otpOk.error || "Invalid OTP", code: "INVALID_INPUT" };
        }
      }

      const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existing) {
        set.status = 409;
        return { success: false, error: "Email already registered", code: "EMAIL_EXISTS" };
      }
      const phoneTaken = await prisma.user.findUnique({ where: { phoneNumber: body.phoneNumber } });
      if (phoneTaken) {
        set.status = 409;
        return { success: false, error: "Phone number already registered", code: "EMAIL_EXISTS" };
      }

      const hashedPassword = await PasswordService.hashPassword(body.password);
      const user = await prisma.user.create({
        data: {
          email: body.email.toLowerCase(),
          phoneNumber: body.phoneNumber,
          firstName: body.firstName,
          lastName: body.lastName,
          password: hashedPassword,
          isPhoneVerified: registerOtpRequired,
          phoneVerifiedAt: registerOtpRequired ? new Date() : undefined,
        },
      });
      await prisma.passwordHistory.create({ data: { userId: user.id, passwordHash: hashedPassword } });

      const accessToken = jwtService.generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = await refreshTokenService.createRefreshToken({
        userId: user.id,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });

      if (body.setAuthCookies !== false) appendAuthCookies(set, accessToken, refreshToken);

      return { success: true, data: { user, accessToken, refreshToken } };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        phoneNumber: t.String({ minLength: 6 }),
        firstName: t.String({ minLength: 1 }),
        lastName: t.String({ minLength: 1 }),
        password: t.String({ minLength: 8, maxLength: 128 }),
        otp: t.Optional(t.String()),
        deviceId: t.Optional(t.String()),
        deviceName: t.Optional(t.String()),
        setAuthCookies: t.Optional(t.Boolean()),
      }),
    }
  )
  .post(
    "/login",
    async ({ body, request, set }) => {
      const ip = getIp(request);
      const emailNorm = body.email.toLowerCase();

      const user = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (!user || !user.password) {
        const block = recordLoginFailure(ip, emailNorm, set);
        if (block) return block;
        set.status = 401;
        return { success: false, error: "Invalid credentials", code: "INVALID_CREDENTIALS" };
      }
      if (user.isBanned) {
        set.status = 403;
        return { success: false, error: "Account is banned", code: "ACCOUNT_BANNED" };
      }
      if (!user.isActive) {
        set.status = 403;
        return { success: false, error: "Account is inactive", code: "FORBIDDEN" };
      }

      const valid = await PasswordService.comparePassword(body.password, user.password);
      if (!valid) {
        const block = recordLoginFailure(ip, emailNorm, set);
        if (block) return block;
        set.status = 401;
        return { success: false, error: "Invalid credentials", code: "INVALID_CREDENTIALS" };
      }

      const accessToken = jwtService.generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = await refreshTokenService.createRefreshToken({
        userId: user.id,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastActivityAt: new Date(), loginCount: { increment: 1 } },
      });

      if (body.setAuthCookies !== false) appendAuthCookies(set, accessToken, refreshToken);

      return { success: true, data: { user, accessToken, refreshToken } };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
        deviceId: t.Optional(t.String()),
        deviceName: t.Optional(t.String()),
        setAuthCookies: t.Optional(t.Boolean()),
      }),
    }
  )
  .post("/logout", async ({ body, set }) => {
    await refreshTokenService.revokeRefreshToken(body.refreshToken);
    if (body.clearAuthCookies !== false) clearAuthCookies(set);
    return { success: true };
  }, { body: t.Object({ refreshToken: t.String(), clearAuthCookies: t.Optional(t.Boolean()) }) })
  .post("/refresh", async ({ body, request, set }) => {
    const result = await refreshTokenService.refreshAccessToken({
      refreshToken: body.refreshToken,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      userAgent: request.headers.get("user-agent") || undefined,
      ipAddress: getIp(request),
    });
    if (!result.success) {
      set.status = 401;
      return { success: false, error: result.error, code: "UNAUTHORIZED" };
    }
    if (body.setAuthCookies !== false && result.accessToken && result.refreshToken) {
      appendAuthCookies(set, result.accessToken, result.refreshToken);
    }
    return { success: true, data: result };
  }, {
    body: t.Object({
      refreshToken: t.String(),
      deviceId: t.Optional(t.String()),
      deviceName: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
    }),
  })
  .post("/send-otp", async ({ body, set }) => {
    const result = await otpService.sendOTP(body.phoneNumber, body.userId);
    if (!result.success) {
      set.status = result.error === "TWILIO_NOT_CONFIGURED" ? 503 : 429;
      return {
        success: false,
        error: result.message,
        code: result.error === "TWILIO_NOT_CONFIGURED" ? ("INTERNAL_ERROR" as const) : ("RATE_LIMIT_EXCEEDED" as const),
      };
    }
    return { success: true, message: result.message };
  }, { body: t.Object({ phoneNumber: t.String(), userId: t.Optional(t.String()) }) })
  .post("/verify-otp", async ({ body, set }) => {
    const result = await otpService.verifyOTP(body.phoneNumber, body.otp);
    if (!result.isValid) {
      set.status = 400;
      return { success: false, error: result.error, code: "INVALID_INPUT" };
    }
    if (body.userId) {
      await prisma.user.update({
        where: { id: body.userId },
        data: { isPhoneVerified: true, phoneVerifiedAt: new Date() },
      });
    }
    return { success: true };
  }, { body: t.Object({ phoneNumber: t.String(), otp: t.String(), userId: t.Optional(t.String()) }) })
  .post("/google/authorize", ({ body }) => ({
    success: true,
    data: { url: googleOAuthService.getAuthorizationUrl(body.state) },
  }), { body: t.Object({ state: t.Optional(t.String()) }) })
  .post("/google/callback", async ({ body, request, set }) => {
    const ip = getIp(request);
    const pre = oauthPreCheck(ip, set);
    if (pre) return pre;
    try {
      const result = await googleOAuthService.processCallback(body.code, {
        deviceId: body.deviceId,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });
      if (body.setAuthCookies !== false) appendAuthCookies(set, result.accessToken, result.refreshToken);
      return { success: true, data: result };
    } catch (error) {
      recordOAuthFailure(ip);
      set.status = 401;
      return { success: false, error: error instanceof Error ? error.message : "OAuth failed", code: "UNAUTHORIZED" };
    }
  }, { body: t.Object({ code: t.String(), deviceId: t.Optional(t.String()), setAuthCookies: t.Optional(t.Boolean()) }) })
  .post("/apple/authorize", ({ body }) => ({
    success: true,
    data: { url: appleOAuthService.getAuthorizationUrl(body.state) },
  }), { body: t.Object({ state: t.Optional(t.String()) }) })
  .post("/apple/callback", async ({ body, request, set }) => {
    const ip = getIp(request);
    const pre = oauthPreCheck(ip, set);
    if (pre) return pre;
    try {
      const result = await appleOAuthService.processCallback({
        code: body.code,
        user: body.user,
        meta: { deviceId: body.deviceId, userAgent: request.headers.get("user-agent") || undefined, ipAddress: ip },
      });
      if (body.setAuthCookies !== false) appendAuthCookies(set, result.accessToken, result.refreshToken);
      return { success: true, data: result };
    } catch (error) {
      recordOAuthFailure(ip);
      set.status = 401;
      return { success: false, error: error instanceof Error ? error.message : "OAuth failed", code: "UNAUTHORIZED" };
    }
  }, {
    body: t.Object({
      code: t.String(),
      deviceId: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
      user: t.Optional(t.Object({
        email: t.Optional(t.String()),
        name: t.Optional(t.Object({ firstName: t.Optional(t.String()), lastName: t.Optional(t.String()) })),
      })),
    }),
  })
  .post("/forgot-password", async ({ body, set }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return { success: true };
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: tokenHash,
        passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    if (process.env.NODE_ENV !== "production") {
      console.log(`[RESET TOKEN] ${user.email}: ${rawToken}`);
    }
    set.status = 200;
    return { success: true };
  }, { body: t.Object({ email: t.String({ format: "email" }) }) })
  .post("/reset-password", async ({ body, set }) => {
    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpires: { gt: new Date() },
      },
    });
    if (!user) {
      set.status = 400;
      return { success: false, error: "Invalid/expired reset token", code: "INVALID_INPUT" };
    }
    const strength = PasswordService.validatePasswordStrength(body.newPassword);
    if (!strength.isValid || PasswordService.isSimilarToUsername(body.newPassword, user.email)) {
      set.status = 400;
      return { success: false, error: "Weak password", code: "INVALID_INPUT", details: strength.errors };
    }
    const history = await prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (await PasswordService.checkPasswordHistory(body.newPassword, history.map((h) => h.passwordHash))) {
      set.status = 400;
      return { success: false, error: "Cannot reuse last 5 passwords", code: "INVALID_INPUT" };
    }
    const passwordHash = await PasswordService.hashPassword(body.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        passwordChangedAt: new Date(),
      },
    });
    await prisma.passwordHistory.create({ data: { userId: user.id, passwordHash } });
    return { success: true };
  }, { body: t.Object({ token: t.String(), newPassword: t.String({ minLength: 8 }) }) })
  .post("/verify-email", async ({ body, set }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) {
      set.status = 404;
      return { success: false, error: "User not found", code: "INVALID_INPUT" };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifiedAt: new Date() },
    });
    return { success: true };
  }, { body: t.Object({ email: t.String({ format: "email" }) }) })
  .get("/sessions", async ({ request, set }) => {
    const authUser = requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    return { success: true, data: await sessionService.getUserSessions(authUser.userId) };
  })
  .delete("/sessions", async ({ request, set }) => {
    const authUser = requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const count = await sessionService.logoutAllSessions(authUser.userId);
    return { success: true, data: { revoked: count } };
  })
  .delete("/sessions/others", async ({ request, set, query }) => {
    const authUser = requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const n = await sessionService.logoutOtherSessions(authUser.userId, query.deviceId);
    return { success: true, data: { revoked: n } };
  }, { query: t.Object({ deviceId: t.Optional(t.String()) }) })
  .patch(
    "/sessions/:id/activity",
    async ({ request, params, set }) => {
      const authUser = requireAuthUser(request, set);
      if (!authUser) {
        return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
      }
      await sessionService.updateSessionActivity(params.id, authUser.userId);
      return { success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )
  .delete("/sessions/:id", async ({ request, params, set }) => {
    const authUser = requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    await sessionService.logoutSession(authUser.userId, params.id);
    return { success: true };
  }, { params: t.Object({ id: t.String() }) })
  .post("/change-password", async ({ request, body, set }) => {
    const authUser = requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }

    const user = await prisma.user.findUnique({ where: { id: authUser.userId } });
    if (!user?.password) {
      set.status = 404;
      return { success: false, error: "User not found", code: "INVALID_INPUT" };
    }

    const oldMatch = await PasswordService.comparePassword(body.currentPassword, user.password);
    if (!oldMatch) {
      set.status = 401;
      return { success: false, error: "Current password is invalid", code: "INVALID_CREDENTIALS" };
    }

    const strength = PasswordService.validatePasswordStrength(body.newPassword);
    if (!strength.isValid || PasswordService.isSimilarToUsername(body.newPassword, user.email)) {
      set.status = 400;
      return { success: false, error: "Weak password", code: "INVALID_INPUT", details: strength.errors };
    }

    const history = await prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const wasUsed = await PasswordService.checkPasswordHistory(
      body.newPassword,
      history.map((h) => h.passwordHash)
    );
    if (wasUsed) {
      set.status = 400;
      return { success: false, error: "Cannot reuse last 5 passwords", code: "INVALID_INPUT" };
    }

    const nextHash = await PasswordService.hashPassword(body.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: nextHash, passwordChangedAt: new Date() },
    });
    await prisma.passwordHistory.create({ data: { userId: user.id, passwordHash: nextHash } });
    return { success: true };
  }, { body: t.Object({ currentPassword: t.String(), newPassword: t.String() }) });
