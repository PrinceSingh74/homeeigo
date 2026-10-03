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
      },
    }).then((res) => res.data);
  },

  refresh() {
    // Cookie mode: the HttpOnly refresh cookie is the credential and only an access token comes back.
    return apiRequest<ApiResponse<{ accessToken: string }>>("/api/auth/refresh", {
      method: "POST",
      body: { deviceId: getDeviceId(), deviceName: getDeviceName() },
    }).then((res) => res.data!);
  },

  logout() {
    // The API reads the refresh cookie, revokes that session and clears the cookie.
    return apiRequest<ApiResponse<unknown>>("/api/auth/logout", {
      method: "POST",
      auth: true,
      body: {},
    });
  },

  me() {
    return apiRequest<ApiResponse<{ user: PartnerUser }>>("/api/user/me", {
      auth: true,
    }).then((res) => res.data!.user);
  },
};
