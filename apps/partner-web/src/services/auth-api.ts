import { apiRequest } from "@/lib/api-client";
import { getDeviceId, getDeviceName } from "@/lib/device";
import type { ApiResponse, LoginPayload, PartnerUser } from "@/types/partner";

export const partnerAuthApi = {
  login(email: string, password: string) {
    return apiRequest<ApiResponse<LoginPayload>>("/api/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        setAuthCookies: false,
      },
    }).then((res) => res.data!);
  },

  sendOtp(phoneNumber: string) {
    return apiRequest<ApiResponse<{ expiresIn: number; attemptsRemaining: number; devOtp?: string }>>(
      "/api/auth/send-otp",
      {
        method: "POST",
        body: { phoneNumber },
      },
    );
  },

  verifyOtp(phoneNumber: string, otp: string) {
    return apiRequest<
      ApiResponse<{
        accessToken: string;
        refreshToken: string;
        userId: string;
        isPhoneVerified: boolean;
        user: {
          id: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
          role?: string;
        };
      }>
    >("/api/auth/verify-otp", {
      method: "POST",
      body: {
        phoneNumber,
        otp,
        login: true,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        setAuthCookies: false,
      },
    }).then((res) => res.data);
  },

  refresh(refreshToken: string) {
    return apiRequest<ApiResponse<{ accessToken: string; refreshToken: string }>>(
      "/api/auth/refresh",
      {
        method: "POST",
        body: {
          refreshToken,
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
          setAuthCookies: false,
        },
      },
    ).then((res) => res.data!);
  },

  logout(refreshToken: string) {
    return apiRequest<ApiResponse<unknown>>("/api/auth/logout", {
      method: "POST",
      auth: true,
      body: { refreshToken, clearAuthCookies: true },
    });
  },

  me() {
    return apiRequest<ApiResponse<{ user: PartnerUser }>>("/api/user/me", {
      auth: true,
    }).then((res) => res.data!.user);
  },
};
