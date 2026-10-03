import { apiRequest } from "@/lib/api-client";
import { getDeviceId, getDeviceName } from "@/lib/device";
import type { ApiResponse, CurrentUser, LoginPayload } from "@/types/admin";

export const adminAuthApi = {
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

  logout() {
    return apiRequest<ApiResponse<unknown>>("/api/auth/logout", {
      method: "POST",
      auth: true,
      // The API reads the refresh cookie, revokes that session and clears the cookie.
      body: {},
    });
  },

  me() {
    return apiRequest<ApiResponse<{ user: CurrentUser }>>("/api/user/me", {
      auth: true,
    }).then((res) => res.data!.user);
  },
};
