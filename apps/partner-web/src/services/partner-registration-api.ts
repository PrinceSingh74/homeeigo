import { apiRequest } from "@/lib/api-client";
import { setRegistrationToken } from "@/lib/registration-session";
import type { ApiResponse } from "@/types/partner";

export type RegistrationStep1Result = {
  userId: string;
  email: string;
  phoneNumber: string;
  step: number;
  nextStep: string;
  devOtp?: string;
};

export const partnerRegistrationApi = {
  step1(body: {
    email: string;
    phoneNumber: string;
    firstName: string;
    lastName: string;
    password: string;
    confirmPassword: string;
  }) {
    return apiRequest<ApiResponse<RegistrationStep1Result>>("/api/partner/register/step1", {
      method: "POST",
      body,
    }).then((r) => r.data!);
  },

  async verifyOtp(body: { email: string; otp: string; userId: string }) {
    const res = await apiRequest<
      ApiResponse<{ userId: string; nextStep: string; registrationToken: string }>
    >("/api/partner/register/verify-otp", { method: "POST", body });
    if (res.data?.registrationToken) {
      setRegistrationToken(res.data.registrationToken);
    }
    return res.data!;
  },

  saveServices(body: { serviceCategories: string[]; city: string; experienceYears: number }) {
    return apiRequest<
      ApiResponse<{ providerId: string; nextStep: string; registrationToken?: string }>
    >("/api/partner/register/services", { method: "POST", body, registration: true }).then((r) => {
      if (r.data?.registrationToken) setRegistrationToken(r.data.registrationToken);
      return r.data!;
    });
  },

  saveKyc(body: {
    panNumber?: string | null;
    aadharNumber?: string | null;
    bankAccountNumber?: string | null;
    bankAccountHolder?: string | null;
    ifscCode?: string | null;
    bankName?: string | null;
  }) {
    return apiRequest<ApiResponse<{ providerId: string; nextStep: string }>>(
      "/api/partner/register/kyc-details",
      { method: "POST", body, registration: true },
    ).then((r) => r.data!);
  },

  submit() {
    return apiRequest<ApiResponse<{ providerId: string; status: string }>>(
      "/api/partner/register/submit",
      { method: "POST", registration: true },
    ).then((r) => r.data!);
  },

  uploadDocument(body: { file: string; documentType: string; fileName?: string }) {
    return apiRequest<ApiResponse<{ documentId: string }>>("/api/partner/documents/upload", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },
};
