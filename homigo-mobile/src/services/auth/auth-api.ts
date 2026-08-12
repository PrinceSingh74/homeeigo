import { ensureDeviceId, getDeviceName } from "@/lib/auth/device";
import { consumePendingReferralCode } from "@/lib/auth/pending-referral";
import { getFraudBodyFields } from "@/lib/fraud/signals";
import type {
  ApiResponse,
  AuthSessionPayload,
  AuthUser,
  PendingRegistration,
} from "@/types/auth";
import { apiRequest } from "./api-client";

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

function mapSession(data: {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
}): AuthSessionPayload {
  return {
    user: sanitizeUser(data.user),
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

export const authApi = {
  async login(email: string, password: string) {
    const deviceId = await ensureDeviceId();
    const res = await apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        deviceId,
        deviceName: getDeviceName(),
        setAuthCookies: false,
      },
    });
    return mapSession(res.data!);
  },

  async register(payload: PendingRegistration & { otp?: string }) {
    const deviceId = await ensureDeviceId();
    const res = await apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/register", {
      method: "POST",
      body: {
        ...payload,
        deviceId,
        deviceName: getDeviceName(),
        ...getFraudBodyFields(),
        setAuthCookies: false,
      },
    });
    return mapSession(res.data!);
  },

  logout(refreshToken: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/logout", {
      method: "POST",
      auth: true,
      body: { refreshToken, clearAuthCookies: true },
    });
  },

  async refresh(refreshToken: string) {
    const deviceId = await ensureDeviceId();
    const res = await apiRequest<ApiResponse<{ accessToken: string; refreshToken: string }>>(
      "/api/auth/refresh",
      {
        method: "POST",
        skipRefresh: true,
        body: {
          refreshToken,
          deviceId,
          deviceName: getDeviceName(),
          setAuthCookies: false,
        },
      },
    );
    return res.data!;
  },

  sendOtp(phoneNumber: string, userId?: string) {
    return apiRequest<ApiResponse<{ devOtp?: string; expiresIn?: number }>>("/api/auth/send-otp", {
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
    }).then((res) => res.data!.user);
  },

  /**
   * `platform: "mobile"` makes the backend issue a Google URL that redirects back
   * to the API's bridge endpoint, which deep-links into this app. Without it Google
   * would send the phone's browser to the website's callback page, which the device
   * cannot reach — the sign-in would hang there forever.
   */
  googleAuthorize(state?: string) {
    return apiRequest<ApiResponse<{ url: string }>>("/api/auth/google/authorize", {
      method: "POST",
      body: { state, platform: "mobile" },
    }).then((res) => res.data!.url);
  },

  async googleCallback(code: string, state?: string | null) {
    const referralCode = await consumePendingReferralCode();
    const deviceId = await ensureDeviceId();
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/google/callback", {
      method: "POST",
      skipRefresh: true,
      body: {
        code,
        state: state ?? undefined,
        deviceId,
        ...getFraudBodyFields(),
        referralCode,
        setAuthCookies: false,
        // Google validates redirect_uri again at token exchange — it must be the
        // same mobile bridge URL the authorize step used.
        platform: "mobile",
      },
    }).then((res) => mapSession(res.data!));
  },

  appleAuthorize(state?: string) {
    return apiRequest<ApiResponse<{ url: string }>>("/api/auth/apple/authorize", {
      method: "POST",
      body: { state },
    }).then((res) => res.data!.url);
  },

  async appleCallback(
    code: string,
    state?: string | null,
    user?: { email?: string; name?: { firstName?: string; lastName?: string } },
  ) {
    const referralCode = await consumePendingReferralCode();
    const deviceId = await ensureDeviceId();
    return apiRequest<ApiResponse<AuthSessionPayload>>("/api/auth/apple/callback", {
      method: "POST",
      skipRefresh: true,
      body: {
        code,
        state: state ?? undefined,
        user,
        deviceId,
        ...getFraudBodyFields(),
        referralCode,
        setAuthCookies: false,
      },
    }).then((res) => mapSession(res.data!));
  },
};
