import { getDeviceId, getDeviceName } from "@/lib/auth/device";
import { AuthApiError } from "@/lib/auth/errors";
import { consumePendingReferralCode } from "@/lib/auth/pending-referral";
import { getFraudBodyFields } from "@/lib/fraud/signals";
import type {
  ApiResponse,
  AuthSessionPayload,
  AuthUser,
  PendingRegistration,
} from "@/types/auth";
import { apiRequest } from "./api-client";

export type SendOtpPayload = {
  expiresIn: number;
  attemptsRemaining: number;
  smsSent?: boolean;
  devOtp?: string;
};

export interface DeviceSession {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt?: string;
  lastActivityAt: string | null;
  isCurrent: boolean; // backend-computed (authoritative)
}

export interface SessionsResponse {
  sessions: DeviceSession[];
  currentSessionId: string | null;
}

function sanitizeUser(raw: Record<string, unknown>): AuthUser {
  const {
    password: _password,
    passwordResetToken: _t,
    passwordResetExpires: _e,
    ...user
  } = raw;
  return user as AuthUser;
}

function mapSession(data: { user: Record<string, unknown>; accessToken: string }): AuthSessionPayload {
  // No refreshToken: for a declared web audience the API keeps it in the HttpOnly cookie.
  return {
    user: sanitizeUser(data.user),
    accessToken: data.accessToken,
  };
}

export const authApi = {
  login(email: string, password: string) {
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
      },
    }).then((res) => mapSession(res.data!));
  },

  register(payload: PendingRegistration & { otp?: string }) {
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/register", {
      method: "POST",
      body: {
        ...payload,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        ...getFraudBodyFields(),
      },
    }).then((res) => mapSession(res.data!));
  },

  logout() {
    // The API reads the refresh cookie, revokes that session and clears the cookie.
    return apiRequest<ApiResponse<unknown>>("/api/auth/logout", {
      method: "POST",
      auth: true,
      body: {},
    });
  },

  refresh() {
    return apiRequest<ApiResponse<{ accessToken: string }>>("/api/auth/refresh", {
      method: "POST",
      skipRefresh: true,
      body: { deviceId: getDeviceId(), deviceName: getDeviceName() },
    }).then((res) => res.data!);
  },

  sendOtp(phoneNumber: string, userId?: string) {
    return apiRequest<ApiResponse<SendOtpPayload>>("/api/auth/send-otp", {
      method: "POST",
      body: { phoneNumber, userId },
    });
  },

  verifyOtp(phoneNumber: string, otp: string, userId?: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/verify-otp", {
      method: "POST",
      body: { phoneNumber, otp, userId },
    });
  },

  verifyOtpSession(phoneNumber: string, otp: string) {
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/verify-otp", {
      method: "POST",
      body: {
        phoneNumber,
        otp,
        login: true,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
      },
    }).then((res) => {
      const data = res.data;
      if (!data?.accessToken || !data.user) {
        throw new AuthApiError(
          "OTP verified but no session was issued. Please try again.",
          500,
          "INTERNAL_ERROR",
        );
      }
      return mapSession(data);
    });
  },

  forgotPassword(email: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/forgot-password", {
      method: "POST",
      body: { email },
    });
  },

  resetPassword(token: string, newPassword: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
    });
  },

  changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/change-password", {
      method: "POST",
      auth: true,
      body: { currentPassword, newPassword },
    });
  },

  verifyEmail(token: string) {
    return apiRequest<ApiResponse<{ emailVerified: boolean; email: string }>>(
      "/api/auth/verify-email",
      { method: "POST", body: { token } },
    );
  },

  sendVerificationEmail() {
    return apiRequest<ApiResponse<{ email: string; sentAt: string; expiresAt: string }>>(
      "/api/auth/send-verification-email",
      { method: "POST", auth: true },
    );
  },

  getSessions(deviceId?: string) {
    const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
    return apiRequest<ApiResponse<SessionsResponse>>(`/api/auth/sessions${q}`, {
      auth: true,
    });
  },

  revokeSession(id: string, deviceId?: string) {
    const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
    return apiRequest<ApiResponse<unknown>>(`/api/auth/sessions/${id}${q}`, {
      method: "DELETE",
      auth: true,
    });
  },

  revokeOtherSessions(deviceId: string) {
    return apiRequest<ApiResponse<{ revoked: number }>>(
      `/api/auth/sessions/others?deviceId=${encodeURIComponent(deviceId)}`,
      { method: "DELETE", auth: true },
    );
  },

  fetchCurrentUser() {
    return apiRequest<ApiResponse<{ user: AuthUser }>>("/api/user/me", {
      auth: true,
      // Called from bootstrap() while status is still "initializing" — waiting
      // on the bootstrap gate here would deadlock (gate opens only after this
      // call finishes).
      skipBootstrapGate: true,
    }).then((res) => res.data!.user);
  },

  googleAuthorize(state?: string) {
    return apiRequest<ApiResponse<{ url: string }>>("/api/auth/google/authorize", {
      method: "POST",
      body: { state },
    }).then((res) => res.data!.url);
  },

  googleCallback(code: string, state?: string | null) {
    const referralCode = consumePendingReferralCode();
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/google/callback", {
      method: "POST",
      skipRefresh: true,
      body: {
        code,
        state: state ?? undefined,
        deviceId: getDeviceId(),
        ...getFraudBodyFields(),
        referralCode,
      },
    }).then((res) => mapSession(res.data!));
  },

  appleAuthorize(state?: string) {
    return apiRequest<ApiResponse<{ url: string }>>("/api/auth/apple/authorize", {
      method: "POST",
      body: { state },
    }).then((res) => res.data!.url);
  },

  appleCallback(
    code: string,
    state?: string | null,
    user?: { email?: string; name?: { firstName?: string; lastName?: string } },
  ) {
    const referralCode = consumePendingReferralCode();
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/apple/callback", {
      method: "POST",
      skipRefresh: true,
      body: {
        code,
        state: state ?? undefined,
        user,
        deviceId: getDeviceId(),
        ...getFraudBodyFields(),
        referralCode,
      },
    }).then((res) => mapSession(res.data!));
  },
};
