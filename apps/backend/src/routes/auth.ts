import "../load-env";
import { Elysia, t } from "elysia";
import crypto from "crypto";
import { appendAuthCookies, clearAuthCookies } from "../lib/auth-cookies";
import { incCounter } from "../lib/metrics";
import prisma from "../lib/prisma";
import {
  consumeRateLimitSmart,
  peekRateLimitSmart,
  resetRateLimitSmart,
} from "../middleware/rate-limit.middleware";
import { AppleOAuthService } from "../services/apple-oauth.service";
import { emailDeliveryService } from "../services/email-delivery.service";
import { referralService } from "../services/referral.service";
import { fraudContextFromRequest } from "../lib/fraud-context";
import {
  fraudContextForOAuth,
  generateReferralCode,
  handleNewOAuthUser,
} from "../lib/oauth-signup-fraud";
import { fraudSignalService } from "../services/fraud-signal.service";
import { consentService } from "../services/consent.service";
import { assertUserMayAuthenticate, assertUserMayAuthenticateByEmail } from "../lib/user-auth-guard";
import { FraudEventType } from "@prisma/client";
import {
  GoogleOAuthService,
  getGoogleAppDeepLink,
  googleRedirectUriFor,
} from "../services/google-oauth.service";
import { JWT_CONFIG, JWTService } from "../services/jwt.service";
import { oauthStateService } from "../services/oauth-state.service";
import { OTPService } from "../services/otp.service";
import { PasswordService } from "../services/password.service";
import { RefreshTokenService } from "../services/refresh-token.service";
import { devicePushService } from "../services/device-push.service";
import { SessionService } from "../services/session.service";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { AuditLogService } from "../services/audit-log.service";
import { tokenRevocationService } from "../services/token-revocation.service";
import { userPiiService } from "../services/user-pii.service";
import { getClientIp } from "../lib/client-ip";
import { parseBody } from "../lib/route-security";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifyAuthSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
} from "../schemas/auth.schema";

const jwtService = new JWTService();
const refreshTokenService = new RefreshTokenService(prisma, jwtService);
const otpService = new OTPService(prisma);
const googleOAuthService = new GoogleOAuthService(prisma, jwtService, refreshTokenService);
const appleOAuthService = new AppleOAuthService(prisma, jwtService, refreshTokenService);
const sessionService = new SessionService(prisma, refreshTokenService);

/** OTP-first registration when REGISTER_REQUIRE_OTP=true or Twilio is configured. */
const registerOtpRequired =
  process.env.REGISTER_REQUIRE_OTP === "true" ||
  (process.env.REGISTER_REQUIRE_OTP !== "false" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN));

const isProd = process.env.NODE_ENV === "production";
/** In dev, skip IP bucket — all local panels share one IP and false attempts pile up fast. */
const LOGIN_FAIL_IP_LIMIT = isProd ? Number(process.env.LOGIN_FAIL_IP_LIMIT || 5) : 0;
const LOGIN_FAIL_IP_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAIL_EMAIL_LIMIT = Number(process.env.LOGIN_FAIL_EMAIL_LIMIT || (isProd ? 10 : 100));
const LOGIN_FAIL_EMAIL_WINDOW_MS = 60 * 60 * 1000;

const loginRateLimitResponse = (set: { status?: number | string }, resetAt: number) => {
  set.status = 429;
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return {
    success: false,
    error: "Too many login attempts. Please try again in 15 minutes.",
    code: "RATE_LIMIT_EXCEEDED" as const,
    retryAfter,
  };
};

/** Per-IP burst gate on auth endpoints — always on (dev + prod) to block credential stuffing. */
const AUTH_BURST_LIMIT = Number(process.env.AUTH_BURST_LIMIT || 15);
const AUTH_BURST_WINDOW_MS = 60_000;

/** Demo / E2E accounts bypass auth burst in non-production so Playwright + smoke:stack stay reliable. */
const isE2eAuthBypass = (credentialKey?: string) =>
  process.env.NODE_ENV !== "production" &&
  typeof credentialKey === "string" &&
  (credentialKey.endsWith("@homigo.demo") || credentialKey.endsWith("@homigo.test"));

const enforceAuthEndpointBurst = async (
  ip: string,
  set: { status?: number | string },
  opts?: { credentialKey?: string; scope?: "login" | "register" | "send-otp" | "forgot-password" },
): Promise<ReturnType<typeof loginRateLimitResponse> | null> => {
  if (isE2eAuthBypass(opts?.credentialKey)) return null;
  const scope = opts?.scope ?? "auth";
  const burst = await consumeRateLimitSmart(
    `auth-burst:${scope}:${ip}`,
    AUTH_BURST_LIMIT,
    AUTH_BURST_WINDOW_MS,
  );
  if (!burst.allowed) {
    incCounter("rate_limit_triggered_total", { scope: `auth_burst_${scope}` });
    return loginRateLimitResponse(set, burst.resetAt);
  }
  if (opts?.credentialKey) {
    const cred = await consumeRateLimitSmart(
      `auth-burst:${scope}:cred:${opts.credentialKey}`,
      AUTH_BURST_LIMIT,
      AUTH_BURST_WINDOW_MS,
    );
    if (!cred.allowed) {
      incCounter("rate_limit_triggered_total", { scope: `auth_burst_${scope}_credential` });
      return loginRateLimitResponse(set, burst.resetAt);
    }
  }
  return null;
};

const requireAuthUser = async (request: Request, set: { status?: number | string }) => {
  const header = request.headers.get("authorization");
  const token = header?.replace(/^Bearer\s+/i, "");
  const payload = token ? jwtService.verifyAccessToken(token) : null;
  if (!payload?.userId) {
    set.status = 401;
    return null;
  }
  try {
    await tokenRevocationService.assertAccessTokenValid(payload);
  } catch {
    set.status = 401;
    return null;
  }
  return { userId: payload.userId, email: payload.email, deviceId: payload.deviceId };
};

const recordLoginFailure = async (ip: string, emailNorm: string, set: { status?: number | string }) => {
  incCounter("failed_login_total");
  const ipKey = `login-fail-ip:${ip}`;
  const emailKey = `login-fail-email:${emailNorm}`;

  const ipPeek =
    LOGIN_FAIL_IP_LIMIT > 0
      ? await peekRateLimitSmart(ipKey, LOGIN_FAIL_IP_LIMIT, LOGIN_FAIL_IP_WINDOW_MS)
      : { allowed: true, resetAt: Date.now() };
  const emailPeek = await peekRateLimitSmart(
    emailKey,
    LOGIN_FAIL_EMAIL_LIMIT,
    LOGIN_FAIL_EMAIL_WINDOW_MS,
  );

  if (!ipPeek.allowed) {
    incCounter("suspicious_activity_total", { kind: "login_brute_force_ip" });
    return loginRateLimitResponse(set, ipPeek.resetAt);
  }
  if (!emailPeek.allowed) {
    incCounter("suspicious_activity_total", { kind: "login_brute_force_email" });
    return loginRateLimitResponse(set, emailPeek.resetAt);
  }

  if (LOGIN_FAIL_IP_LIMIT > 0) {
    await consumeRateLimitSmart(ipKey, LOGIN_FAIL_IP_LIMIT, LOGIN_FAIL_IP_WINDOW_MS);
  }
  await consumeRateLimitSmart(emailKey, LOGIN_FAIL_EMAIL_LIMIT, LOGIN_FAIL_EMAIL_WINDOW_MS);
  return null;
};

const clearLoginFailureCounters = async (ip: string, emailNorm: string) => {
  if (LOGIN_FAIL_IP_LIMIT > 0) await resetRateLimitSmart(`login-fail-ip:${ip}`);
  await resetRateLimitSmart(`login-fail-email:${emailNorm}`);
};

const oauthPreCheck = async (ip: string, set: { status?: number | string }) => {
  const failLimit = await consumeRateLimitSmart(`oauth-fail:${ip}`, 3, 60 * 60 * 1000);
  if (!failLimit.allowed) {
    set.status = 429;
    return {
      success: false,
      error: "Too many OAuth callback failures. Try again in one hour.",
      code: "RATE_LIMIT_EXCEEDED" as const,
    };
  }
  const attempts = await consumeRateLimitSmart(`oauth-callback-ip:${ip}`, 10, 60 * 60 * 1000);
  if (!attempts.allowed) {
    set.status = 429;
    return { success: false, error: "Too many OAuth attempts", code: "RATE_LIMIT_EXCEEDED" as const };
  }
  return null;
};

const recordOAuthFailure = async (ip: string) => {
  await consumeRateLimitSmart(`oauth-fail:${ip}`, 3, 60 * 60 * 1000);
};

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    "/register",
    async ({ body: raw, request, set }) => {
      const ip = getClientIp(request);
      const burstBlock = await enforceAuthEndpointBurst(ip, set, { scope: "register" });
      if (burstBlock) return burstBlock;

      const body = parseBody(registerSchema, raw, {
        firstName: { maxLen: 50 },
        lastName: { maxLen: 50 },
      });
      const e2eRegister =
        process.env.NODE_ENV !== "production" &&
        typeof body.email === "string" &&
        (body.email.toLowerCase().endsWith("@homigo.test") ||
          body.email.toLowerCase().endsWith("@homigo.demo"));
      if (!e2eRegister) {
        const limiter = await consumeRateLimitSmart(`register:${ip}`, 10, 60 * 60 * 1000);
        if (!limiter.allowed) {
          set.status = 429;
          return {
            success: false,
            error: "Rate limit exceeded",
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter: 3600,
          };
        }
      }

      const passwordCheck = PasswordService.validatePasswordStrength(body.password);
      if (!passwordCheck.isValid || PasswordService.isSimilarToUsername(body.password, body.email)) {
        set.status = 400;
        return { success: false, error: "Weak password", code: "INVALID_INPUT", details: passwordCheck.errors };
      }

      if (body.confirmPassword && body.confirmPassword !== body.password) {
        set.status = 400;
        return { success: false, error: "Passwords do not match", code: "VALIDATION_ERROR" };
      }
      const specFlow = registerOtpRequired && !body.otp;

      if (!specFlow && registerOtpRequired) {
        const otpOk = await otpService.verifyOTP(body.phoneNumber, body.otp!);
        if (!otpOk.isValid) {
          set.status = 400;
          return {
            success: false,
            error: otpOk.error || "Invalid OTP",
            code: "INVALID_OTP",
            attemptsRemaining: 2,
          };
        }
      }

      if (await userPiiService.emailExists(body.email)) {
        set.status = 409;
        return { success: false, error: "Email already registered", code: "EMAIL_EXISTS" };
      }
      if (await userPiiService.phoneExists(body.phoneNumber)) {
        set.status = 409;
        return { success: false, error: "Phone number already registered", code: "EMAIL_EXISTS" };
      }

      const hashedPassword = await PasswordService.hashPassword(body.password);
      const ownReferralCode = generateReferralCode(body.firstName);
      const user = await prisma.user.create({
        data: {
          email: body.email,
          phoneNumber: body.phoneNumber,
          firstName: body.firstName,
          lastName: body.lastName,
          password: hashedPassword,
          isPhoneVerified: !specFlow && registerOtpRequired,
          phoneVerifiedAt: !specFlow && registerOtpRequired ? new Date() : undefined,
          referralCode: ownReferralCode,
        },
      });
      await prisma.passwordHistory.create({ data: { userId: user.id, passwordHash: hashedPassword } });
      const contact = await userPiiService.resolveEmailAndPhone(user, { actorId: user.id });

      const fraudCtx = fraudContextFromRequest(request, user.id, {
        deviceId: body.deviceId,
        browserFingerprint: body.browserFingerprint,
        deviceFingerprint: body.deviceFingerprint,
        timezone: body.timezone,
      });

      void fraudSignalService
        .capture(FraudEventType.SIGNUP, fraudCtx, { id: user.id, type: "user" })
        .catch(() => {});

      await consentService.recordSignupConsents(user.id, {
        ipAddress: ip,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });

      // Referral capture: if they signed up with a friend's code, record it (fraud-gated).
      if (body.referralCode) {
        const referrer = await prisma.user.findUnique({
          where: { referralCode: body.referralCode.toUpperCase() },
          select: { id: true },
        });
        if (referrer && referrer.id !== user.id) {
          await prisma.user.update({ where: { id: user.id }, data: { referredBy: referrer.id } });
          await referralService.recordSignup(
            referrer.id,
            user.id,
            body.referralCode.toUpperCase(),
            fraudCtx,
          );
        }
      }

      void AuditLogService.success("REGISTER", {
        userId: user.id,
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
      });

      if (contact.email) {
        emailDeliveryService.sendWelcome(contact.email, user.firstName);
      }

      if (specFlow) {
        const otpResult = await otpService.sendOTP(body.phoneNumber, user.id);
        if (!otpResult.success) {
          set.status =
            otpResult.error === "TWILIO_NOT_CONFIGURED"
              ? 503
              : otpResult.error === "SMS_DELIVERY_FAILED"
                ? 502
                : 429;
          return {
            success: false,
            error: otpResult.message,
            code:
              otpResult.error === "TWILIO_NOT_CONFIGURED"
                ? "INTERNAL_ERROR"
                : otpResult.error === "SMS_DELIVERY_FAILED"
                  ? "SMS_DELIVERY_FAILED"
                  : "RATE_LIMIT_EXCEEDED",
          };
        }

        set.status = 201;
        return {
          success: true,
          message: "Registration successful. OTP sent to phone.",
          data: {
            userId: user.id,
            email: contact.email,
            phoneNumber: contact.phoneNumber,
            firstName: user.firstName,
            lastName: user.lastName,
            otpRequired: true,
            otpExpiresIn: 300,
            ...("devOtp" in otpResult && otpResult.devOtp ? { devOtp: otpResult.devOtp } : {}),
          },
        };
      }

      const { accessToken, refreshToken } = await refreshTokenService.createSessionTokens({
        userId: user.id,
        email: contact.email ?? body.email,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });

      if (body.setAuthCookies !== false) appendAuthCookies(set, accessToken, refreshToken);

      return {
        success: true,
        message: "Registration successful",
        data: {
          user: { ...user, email: contact.email, phoneNumber: contact.phoneNumber },
          accessToken,
          refreshToken,
          expiresIn: JWT_CONFIG.ACCESS_TOKEN_SECONDS,
        },
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        phoneNumber: t.String({ minLength: 13, maxLength: 13 }),
        firstName: t.String({ minLength: 2 }),
        lastName: t.String({ minLength: 2 }),
        password: t.String({ minLength: 8, maxLength: 128 }),
        confirmPassword: t.Optional(t.String()),
        agreeToTerms: t.Optional(t.Boolean()),
        otp: t.Optional(t.String()),
        deviceId: t.Optional(t.String()),
        deviceName: t.Optional(t.String()),
        setAuthCookies: t.Optional(t.Boolean()),
        referralCode: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/login",
    async ({ body: raw, request, set }) => {
      const body = parseBody(loginSchema, raw);
      const ip = getClientIp(request);
      const burstBlock = await enforceAuthEndpointBurst(ip, set, {
        scope: "login",
        credentialKey: body.email.toLowerCase(),
      });
      if (burstBlock) return burstBlock;

      const emailNorm = body.email;

      const user = await userPiiService.findByEmail(emailNorm);
      if (!user || !user.password) {
        const block = await recordLoginFailure(ip, emailNorm, set);
        void AuditLogService.failure("FAILED_LOGIN", {
          ipAddress: ip,
          userAgent: request.headers.get("user-agent"),
          reason: block ? "rate_limited" : "unknown_email",
        });
        if (block) return block;
        set.status = 401;
        return { success: false, error: "Invalid email or password", code: "INVALID_CREDENTIALS" };
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
        const block = await recordLoginFailure(ip, emailNorm, set);
        void AuditLogService.failure("FAILED_LOGIN", {
          userId: user.id,
          ipAddress: ip,
          userAgent: request.headers.get("user-agent"),
          reason: block ? "rate_limited" : "bad_password",
        });
        if (block) return block;
        set.status = 401;
        return { success: false, error: "Invalid email or password", code: "INVALID_CREDENTIALS" };
      }

      if (user.role === "VENDOR") {
        const approvalBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
        if (approvalBlock) {
          set.status = 403;
          return {
            success: false,
            error: approvalBlock,
            code: "PARTNER_NOT_APPROVED",
          };
        }
      }

      const loginContact = await userPiiService.resolveEmailAndPhone(user, { actorId: user.id });
      const { accessToken, refreshToken } = await refreshTokenService.createSessionTokens({
        userId: user.id,
        email: loginContact.email ?? emailNorm,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });

      await clearLoginFailureCounters(ip, emailNorm);

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastActivityAt: new Date(), loginCount: { increment: 1 } },
      });

      void AuditLogService.success("LOGIN", {
        userId: user.id,
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
      });

      if (body.setAuthCookies !== false) appendAuthCookies(set, accessToken, refreshToken);

      return {
        success: true,
        message: "Login successful",
        data: {
          userId: user.id,
          accessToken,
          refreshToken,
          expiresIn: JWT_CONFIG.ACCESS_TOKEN_SECONDS,
          user: {
            id: user.id,
            email: loginContact.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImage: user.profileImage,
            walletBalance: user.walletBalance,
            isPhoneVerified: user.isPhoneVerified,
          },
        },
      };
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
  .post(
    "/logout",
    async ({ body, request, set }) => {
      const authHeader = request.headers.get("authorization");
      const payload = authHeader ? jwtService.verifyAccessToken(authHeader) : null;

      if (!payload?.userId) {
        set.status = 401;
        return { success: false, error: "Invalid or expired token", code: "UNAUTHORIZED" };
      }

      const rawAccess = authHeader?.replace(/^Bearer\s+/i, "");
      if (rawAccess) {
        await tokenRevocationService.revokeAccessTokenFromRaw(
          rawAccess,
          payload.userId,
          "LOGOUT",
          payload.userId,
          {
            ipAddress: getClientIp(request),
            userAgent: request.headers.get("user-agent") || undefined,
          },
          (t) => jwtService.decodeToken(t),
        );
      }

      if (body.allDevices) {
        await refreshTokenService.revokeAllUserTokens(
          payload.userId,
          "LOGOUT",
          payload.userId,
          {
            ipAddress: getClientIp(request),
            userAgent: request.headers.get("user-agent") || undefined,
          },
        );
        await devicePushService.revokeAll(payload.userId);
      } else if (body.refreshToken) {
        await refreshTokenService.revokeRefreshToken(body.refreshToken, "LOGOUT");
      } else if (body.deviceId) {
        await refreshTokenService.revokeDeviceToken(payload.userId, body.deviceId);
        await devicePushService.revokeDevice(payload.userId, body.deviceId);
      }

      void AuditLogService.success("LOGOUT", {
        userId: payload.userId,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
        details: { allDevices: Boolean(body.allDevices) },
      });

      if (body.clearAuthCookies !== false) clearAuthCookies(set);
      return { success: true, message: "Logged out successfully" };
    },
    {
      body: t.Object({
        refreshToken: t.Optional(t.String()),
        allDevices: t.Optional(t.Boolean()),
        deviceId: t.Optional(t.String()),
        clearAuthCookies: t.Optional(t.Boolean()),
      }),
    },
  )
  .post("/refresh", async ({ body: raw, request, set }) => {
    const body = parseBody(refreshTokenSchema, raw);
    const result = await refreshTokenService.refreshAccessToken({
      refreshToken: body.refreshToken,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      userAgent: request.headers.get("user-agent") || undefined,
      ipAddress: getClientIp(request),
    });
    if (!result.success) {
      incCounter("jwt_refresh_total", { outcome: "failure" });
      incCounter("auth_refresh_total", { outcome: "failure" });
      incCounter("auth_refresh_failures");
      set.status = 401;
      return { success: false, error: "Invalid or expired refresh token", code: "INVALID_TOKEN" };
    }
    incCounter("jwt_refresh_total", { outcome: "success" });
    incCounter("auth_refresh_total", { outcome: "success" });
    if (body.setAuthCookies !== false && result.accessToken && result.refreshToken) {
      appendAuthCookies(set, result.accessToken, result.refreshToken);
    }
    return {
      success: true,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: JWT_CONFIG.ACCESS_TOKEN_SECONDS,
      },
    };
  }, {
    body: t.Object({
      refreshToken: t.String(),
      deviceId: t.Optional(t.String()),
      deviceName: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
    }),
  })
  .post("/send-otp", async ({ body: raw, request, set }) => {
    const ip = getClientIp(request);
    const body = parseBody(otpRequestSchema, raw);
    const burstBlock = await enforceAuthEndpointBurst(ip, set, {
      scope: "send-otp",
      credentialKey: body.phoneNumber,
    });
    if (burstBlock) return burstBlock;
    const result = await otpService.sendOTP(body.phoneNumber, body.userId);
    if (!result.success) {
      set.status =
        result.error === "TWILIO_NOT_CONFIGURED"
          ? 503
          : result.error === "SMS_DELIVERY_FAILED"
            ? 502
            : 429;
      return {
        success: false,
        error: result.message,
        code:
          result.error === "TWILIO_NOT_CONFIGURED"
            ? ("INTERNAL_ERROR" as const)
            : result.error === "SMS_DELIVERY_FAILED"
              ? ("SMS_DELIVERY_FAILED" as const)
              : ("RATE_LIMIT_EXCEEDED" as const),
        retryAfter:
          result.error === "TWILIO_NOT_CONFIGURED" || result.error === "SMS_DELIVERY_FAILED"
            ? undefined
            : 3600,
      };
    }
    return {
      success: true,
      message: "OTP sent successfully",
      data: {
        expiresIn: 300,
        attemptsRemaining: 3,
        ...("devOtp" in result && result.devOtp ? { devOtp: result.devOtp } : {}),
      },
    };
  }, { body: t.Object({ phoneNumber: t.String(), userId: t.Optional(t.String()) }) })
  .post("/verify-otp", async ({ body: raw, request, set }) => {
    const body = parseBody(otpVerifyAuthSchema, raw);
    let phone = body.phoneNumber;
    if (!phone && body.email) {
      const emailUser = await userPiiService.findByEmail(body.email);
      phone = emailUser
        ? (await userPiiService.resolvePhone(emailUser, { actorId: emailUser.id, authorized: true })) ?? undefined
        : undefined;
    }
    if (!phone) {
      set.status = 404;
      return { success: false, error: "User not found", code: "USER_NOT_FOUND" };
    }

    const result = await otpService.verifyOTP(phone, body.otp);
    if (!result.isValid) {
      set.status = result.error?.includes("Max") ? 429 : 400;
      return {
        success: false,
        error: result.error || "Invalid OTP",
        code: result.error?.includes("Max") ? "RATE_LIMIT_EXCEEDED" : "INVALID_OTP",
        attemptsRemaining: 2,
      };
    }

    const user = body.email
      ? await userPiiService.findByEmail(body.email)
      : body.userId
        ? await prisma.user.findUnique({ where: { id: body.userId } })
        : phone
          ? await userPiiService.findByPhone(phone)
          : null;
    if (!user) {
      set.status = 404;
      return { success: false, error: "User not found", code: "USER_NOT_FOUND" };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isPhoneVerified: true, phoneVerifiedAt: new Date() },
    });

    if (body.email || body.completeRegistration || body.login) {
      try {
        await assertUserMayAuthenticate(user.id);
      } catch {
        set.status = 403;
        return { success: false, error: "Account suspended", code: "ACCOUNT_SUSPENDED" };
      }
      if (user.role === "VENDOR") {
        const approvalBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
        if (approvalBlock) {
          set.status = 403;
          return { success: false, error: approvalBlock, code: "PARTNER_NOT_APPROVED" };
        }
      }
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        "unknown";
      const otpContact = await userPiiService.resolveEmailAndPhone(user, { actorId: user.id });
      const { accessToken, refreshToken } = await refreshTokenService.createSessionTokens({
        userId: user.id,
        email: otpContact.email ?? body.email ?? "",
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        userAgent: request.headers.get("user-agent") || undefined,
        ipAddress: ip,
      });
      if (body.setAuthCookies !== false) appendAuthCookies(set, accessToken, refreshToken);
      return {
        success: true,
        message: "OTP verified successfully",
        data: {
          userId: user.id,
          isPhoneVerified: true,
          accessToken,
          refreshToken,
          expiresIn: JWT_CONFIG.ACCESS_TOKEN_SECONDS,
          user: {
            id: user.id,
            email: otpContact.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            walletBalance: user.walletBalance,
          },
        },
      };
    }

    return { success: true, message: "OTP verified successfully" };
  }, {
    body: t.Object({
      phoneNumber: t.Optional(t.String()),
      email: t.Optional(t.String({ format: "email" })),
      otp: t.String(),
      userId: t.Optional(t.String()),
      completeRegistration: t.Optional(t.Boolean()),
      login: t.Optional(t.Boolean()),
      deviceId: t.Optional(t.String()),
      deviceName: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
    }),
  })
  .post("/google/authorize", ({ body, set }) => {
    try {
      const state = oauthStateService.issue("google", body.state);
      // The mobile app needs Google to come back to THIS API (which then deep-links
      // into the app); the web app keeps its own callback page.
      const redirectUri = googleRedirectUriFor(body.platform);
      return {
        success: true,
        data: { url: googleOAuthService.getAuthorizationUrl(state, redirectUri), state, redirectUri },
      };
    } catch (error) {
      set.status = 503;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Google Sign-In is not configured",
        code: "SERVICE_UNAVAILABLE" as const,
      };
    }
  }, {
    body: t.Object({
      state: t.Optional(t.String()),
      platform: t.Optional(t.Union([t.Literal("web"), t.Literal("mobile")])),
    }),
  })
  /**
   * Bridge for the mobile app: Google redirects the phone's browser here, and we
   * bounce it into the app over its custom scheme. Google will not accept a
   * custom scheme as a Web-client redirect URI, so this hop is what makes native
   * sign-in possible without a separate Android/iOS OAuth client.
   *
   * Carries no secrets — just the opaque code and the state the app already
   * issued and will validate. The code is still exchanged server-side.
   */
  .get("/google/mobile-callback", ({ query, set }) => {
    const target = new URL(getGoogleAppDeepLink());
    for (const key of ["code", "state", "error"] as const) {
      const value = query[key];
      if (value) target.searchParams.set(key, value);
    }
    set.status = 302;
    set.headers["location"] = target.toString();
    set.headers["cache-control"] = "no-store";
    return "";
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
    }),
  })
  .post("/google/callback", async ({ body, request, set }) => {
    const ip = getClientIp(request);
    const pre = await oauthPreCheck(ip, set);
    if (pre) return pre;
    const stateOk = oauthStateService.consume("google", body.state);
    if (!stateOk) {
      set.status = 400;
      return { success: false, error: "Invalid authorization code", code: "INVALID_CODE" };
    }
    try {
      // Must match the redirect_uri used at authorize or Google rejects the exchange.
      const result = await googleOAuthService.processCallback(
        body.code,
        {
          deviceId: body.deviceId,
          userAgent: request.headers.get("user-agent") || undefined,
          ipAddress: ip,
        },
        googleRedirectUriFor(body.platform),
      );
      if (result.isNewUser) {
        const fraudCtx = fraudContextForOAuth(request, result.user.id, body);
        await handleNewOAuthUser(result.user.id, fraudCtx, body.referralCode);
      }
      if (body.setAuthCookies !== false) appendAuthCookies(set, result.accessToken, result.refreshToken);
      const { isNewUser: _n, ...session } = result;
      return { success: true, data: session };
    } catch (err) {
      await recordOAuthFailure(ip);
      if (err instanceof Error && err.message === "PARTNER_NOT_APPROVED") {
        set.status = 403;
        return { success: false, error: "Partner application not approved", code: "PARTNER_NOT_APPROVED" };
      }
      set.status = 400;
      return { success: false, error: "Invalid authorization code", code: "INVALID_CODE" };
    }
  }, {
    body: t.Object({
      code: t.String(),
      state: t.Optional(t.String()),
      deviceId: t.Optional(t.String()),
      browserFingerprint: t.Optional(t.String()),
      deviceFingerprint: t.Optional(t.String()),
      timezone: t.Optional(t.String()),
      referralCode: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
      platform: t.Optional(t.Union([t.Literal("web"), t.Literal("mobile")])),
    }),
  })
  .post("/apple/authorize", ({ body }) => ({
    success: true,
    data: (() => {
      const state = oauthStateService.issue("apple", body.state);
      return { url: appleOAuthService.getAuthorizationUrl(state), state };
    })(),
  }), { body: t.Object({ state: t.Optional(t.String()) }) })
  .post("/apple/callback", async ({ body, request, set }) => {
    const ip = getClientIp(request);
    const pre = await oauthPreCheck(ip, set);
    if (pre) return pre;
    const stateOk = oauthStateService.consume("apple", body.state);
    if (!stateOk) {
      set.status = 400;
      return { success: false, error: "Invalid authorization code", code: "INVALID_CODE" };
    }
    try {
      const result = await appleOAuthService.processCallback({
        code: body.code,
        user: body.user,
        meta: { deviceId: body.deviceId, userAgent: request.headers.get("user-agent") || undefined, ipAddress: ip },
      });
      if (result.isNewUser) {
        const fraudCtx = fraudContextForOAuth(request, result.user.id, body);
        await handleNewOAuthUser(result.user.id, fraudCtx, body.referralCode);
      }
      if (body.setAuthCookies !== false) appendAuthCookies(set, result.accessToken, result.refreshToken);
      const { isNewUser: _n, ...session } = result;
      return { success: true, data: session };
    } catch (err) {
      await recordOAuthFailure(ip);
      if (err instanceof Error && err.message === "PARTNER_NOT_APPROVED") {
        set.status = 403;
        return { success: false, error: "Partner application not approved", code: "PARTNER_NOT_APPROVED" };
      }
      set.status = 400;
      return { success: false, error: "Invalid authorization code", code: "INVALID_CODE" };
    }
  }, {
    body: t.Object({
      code: t.String(),
      state: t.Optional(t.String()),
      deviceId: t.Optional(t.String()),
      browserFingerprint: t.Optional(t.String()),
      deviceFingerprint: t.Optional(t.String()),
      timezone: t.Optional(t.String()),
      referralCode: t.Optional(t.String()),
      setAuthCookies: t.Optional(t.Boolean()),
      user: t.Optional(t.Object({
        email: t.Optional(t.String()),
        name: t.Optional(t.Object({ firstName: t.Optional(t.String()), lastName: t.Optional(t.String()) })),
      })),
    }),
  })
  .post("/forgot-password", async ({ body: raw, request, set }) => {
    const body = parseBody(forgotPasswordSchema, raw);
    const ip = getClientIp(request);
    const limiter = await consumeRateLimitSmart(`forgot:${ip}`, 5, 60 * 60 * 1000);
    if (!limiter.allowed) {
      set.status = 429;
      return {
        success: false,
        error: "Too many reset requests. Try again later.",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: 3600,
      };
    }

    const user = await userPiiService.findByEmail(body.email);
    set.status = 200;
    const genericResponse = {
      success: true,
      message: "If an account exists for this email, a reset link has been sent.",
      data: { expiresIn: 1800 },
    };
    if (!user) return genericResponse;

    const userEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    if (!userEmail) return genericResponse;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: tokenHash,
        passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    void AuditLogService.success("PASSWORD_RESET_REQUEST", {
      userId: user.id,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent"),
    });

    emailDeliveryService.sendPasswordReset(userEmail, rawToken, user.firstName);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[RESET TOKEN] user=${user.id}: ${rawToken}`);
    }
    return genericResponse;
  }, { body: t.Object({ email: t.String({ format: "email" }) }) })
  .post("/reset-password", async ({ body: raw, set }) => {
    const body = parseBody(resetPasswordSchema, raw);
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
    const resetEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    const strength = PasswordService.validatePasswordStrength(body.newPassword);
    if (!strength.isValid || (resetEmail && PasswordService.isSimilarToUsername(body.newPassword, resetEmail))) {
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
    await refreshTokenService.revokeAllUserTokens(user.id, "PASSWORD_RESET", user.id);
    void AuditLogService.success("PASSWORD_RESET", { userId: user.id });
    return { success: true };
  }, { body: t.Object({ token: t.String(), newPassword: t.String({ minLength: 8 }) }) })
  // Verify email via a single-use, 24h, hashed token (sent by email). Public:
  // the token itself is the credential, so no session is required.
  .post("/verify-email", async ({ body, set }) => {
    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const user = await prisma.user.findFirst({ where: { emailVerificationToken: tokenHash } });
    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      set.status = 400;
      return { success: false, error: "Invalid or expired verification token", code: "INVALID_VERIFICATION_TOKEN" };
    }
    if (user.isEmailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerificationToken: null, emailVerificationExpires: null },
      });
      set.status = 400;
      return { success: false, error: "Email already verified", code: "EMAIL_ALREADY_VERIFIED" };
    }
    const verifiedAt = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerifiedAt: verifiedAt,
        emailVerificationToken: null, // single-use: consume the token
        emailVerificationExpires: null,
      },
    });
    const verifiedEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    void AuditLogService.success("EMAIL_VERIFIED", { userId: user.id });
    return { success: true, data: { emailVerified: true, emailVerifiedAt: verifiedAt, email: verifiedEmail } };
  }, { body: t.Object({ token: t.String({ minLength: 10 }) }) })
  // Send (or resend) the verification email. Authed: only the logged-in user can
  // request verification for their own email. Rate-limited to curb spam.
  .post("/send-verification-email", async ({ request, set }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const user = await prisma.user.findUnique({ where: { id: authUser.userId } });
    if (!user) {
      set.status = 404;
      return { success: false, error: "User not found", code: "NOT_FOUND" };
    }
    if (user.isEmailVerified) {
      set.status = 400;
      return { success: false, error: "Email already verified", code: "EMAIL_ALREADY_VERIFIED" };
    }
    const limiter = await consumeRateLimitSmart(`email-verify:${user.id}`, 3, 15 * 60 * 1000);
    if (!limiter.allowed) {
      set.status = 429;
      return {
        success: false,
        error: "Too many verification requests. Please wait before resending.",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: 300,
      };
    }
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash, emailVerificationExpires: expiresAt },
    });
    const verifyEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    if (verifyEmail) {
      emailDeliveryService.sendVerification(verifyEmail, rawToken, user.firstName);
    }
    return {
      success: true,
      data: { message: "Verification email sent", email: verifyEmail, sentAt: new Date(), expiresAt },
    };
  })
  .get("/sessions", async ({ request, set, query }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    // Authoritative: derive the current device from the signed token. Fall back
    // to the query param only for older tokens minted without a deviceId claim.
    const currentDeviceId = authUser.deviceId ?? query.deviceId;
    return {
      success: true,
      data: await sessionService.getUserSessions(authUser.userId, currentDeviceId),
    };
  }, { query: t.Object({ deviceId: t.Optional(t.String()) }) })
  .delete("/sessions", async ({ request, set }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const count = await sessionService.logoutAllSessions(authUser.userId);
    return { success: true, data: { revoked: count } };
  })
  .delete("/sessions/others", async ({ request, set, query }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const n = await sessionService.logoutOtherSessions(authUser.userId, authUser.deviceId ?? query.deviceId);
    return { success: true, data: { revoked: n } };
  }, { query: t.Object({ deviceId: t.Optional(t.String()) }) })
  .patch(
    "/sessions/:id/activity",
    async ({ request, params, set }) => {
      const authUser = await requireAuthUser(request, set);
      if (!authUser) {
        return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
      }
      await sessionService.updateSessionActivity(params.id, authUser.userId);
      return { success: true };
    },
    { params: t.Object({ id: t.String() }) }
  )
  .delete("/sessions/:id", async ({ request, params, set, query }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    // Security: the caller cannot log out their own current-device session by id.
    // Prefer the token's deviceId (authoritative) over the client-sent param.
    const currentDeviceId = authUser.deviceId ?? query.deviceId;
    if (currentDeviceId) {
      const { sessions } = await sessionService.getUserSessions(authUser.userId, currentDeviceId);
      if (sessions.find((s) => s.id === params.id)?.isCurrent) {
        set.status = 403;
        return { success: false, error: "Cannot logout current device", code: "CANNOT_DELETE_CURRENT" };
      }
    }
    await sessionService.logoutSession(authUser.userId, params.id);
    return { success: true };
  }, { params: t.Object({ id: t.String() }), query: t.Object({ deviceId: t.Optional(t.String()) }) })
  .post("/change-password", async ({ request, body: raw, set }) => {
    const authUser = await requireAuthUser(request, set);
    if (!authUser) {
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }

    const body = parseBody(changePasswordSchema, raw);

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

    const changeEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    const strength = PasswordService.validatePasswordStrength(body.newPassword);
    if (!strength.isValid || (changeEmail && PasswordService.isSimilarToUsername(body.newPassword, changeEmail))) {
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
    await refreshTokenService.revokeAllUserTokens(user.id, "PASSWORD_RESET", user.id);
    void AuditLogService.success("PASSWORD_CHANGE", {
      userId: user.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return { success: true };
  }, { body: t.Object({ currentPassword: t.String(), newPassword: t.String() }) });
