import { getApiBaseUrl } from "@/lib/api-config";
import {
  clearRegistrationToken,
  getRegistrationToken,
  setRegistrationToken,
} from "@/lib/registration-session";
import type { OnboardingProgressPayload } from "@/lib/onboarding-resume";

type ApiResponse<T> = { success: boolean; data?: T; error?: string; message?: string };

async function regRequest<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getRegistrationToken();
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-registration-token": token } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? json.message ?? "Request failed");
  }
  return json.data as T;
}

export const partnerRegistrationApi = {
  step1(body: {
    email: string;
    phoneNumber: string;
    firstName: string;
    lastName: string;
    password: string;
    confirmPassword: string;
  }) {
    return regRequest<{ userId: string; devOtp?: string }>("/api/partner/register/step1", { method: "POST", body });
  },
  verifyOtp(body: { email: string; otp: string; userId: string; inviteToken?: string }) {
    return regRequest<{ registrationToken: string }>("/api/partner/register/verify-otp", { method: "POST", body }).then(
      async (d) => {
        if (d.registrationToken) await setRegistrationToken(d.registrationToken);
        return d;
      },
    );
  },
  resumeApplication(body: { email: string; password: string }) {
    return regRequest<
      OnboardingProgressPayload & { userId: string; email: string; registrationToken: string }
    >("/api/partner/register/resume", { method: "POST", body }).then(async (d) => {
      if (d.registrationToken) await setRegistrationToken(d.registrationToken);
      return d;
    });
  },
  getProgress() {
    return regRequest<OnboardingProgressPayload>("/api/partner/onboarding/progress");
  },
  saveServices(body: { serviceCategories: string[]; city: string; experienceYears: number }) {
    return regRequest<{ providerId: string; registrationToken?: string }>("/api/partner/register/services", {
      method: "POST",
      body,
    }).then(async (d) => {
      if (d.registrationToken) await setRegistrationToken(d.registrationToken);
      return d;
    });
  },
  saveSkills(body: {
    primarySkill: string;
    secondarySkills?: string[];
    experienceYears: number;
  }) {
    return regRequest<unknown>("/api/partner/onboarding/skills", { method: "POST", body });
  },
  saveProfile(body: Record<string, string | undefined>) {
    return regRequest<unknown>("/api/partner/onboarding/profile", { method: "POST", body });
  },
  saveLocation(body: {
    city: string;
    serviceRegions: string[];
    serviceRadiusKm: number;
  }) {
    return regRequest<unknown>("/api/partner/onboarding/location", { method: "POST", body });
  },
  saveAvailability(body: {
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: string[];
  }) {
    return regRequest<unknown>("/api/partner/onboarding/availability", { method: "POST", body });
  },
  saveKyc(body: Record<string, string | undefined>) {
    return regRequest<unknown>("/api/partner/register/kyc-details", { method: "POST", body });
  },
  uploadDocument(body: { file: string; documentType: string; fileName?: string }) {
    return regRequest<{ documentId: string }>("/api/partner/documents/upload", { method: "POST", body });
  },
  listDocuments() {
    return regRequest<{ documents: Array<{ id: string; documentType: string; isVerified: boolean }> }>(
      "/api/partner/documents",
    ).then((d) => d.documents ?? []);
  },
  completeDocuments(uploadedTypes: string[]) {
    return regRequest<unknown>("/api/partner/onboarding/documents", {
      method: "POST",
      body: { uploadedTypes },
    });
  },
  getAssessment() {
    return regRequest<{
      skillSlug: string;
      passScore: number;
      questions: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>;
    }>("/api/partner/onboarding/assessment");
  },
  runAssessment(body: { skillSlug: string; answers: Record<string, string> }) {
    return regRequest<{
      passed: boolean;
      score: number;
      maxScore: number;
      correctCount: number;
      total: number;
      status: string;
    }>("/api/partner/onboarding/assessment", { method: "POST", body });
  },
  getInvite(token: string) {
    return fetch(`${getApiBaseUrl()}/api/partner/register/invite?token=${encodeURIComponent(token)}`).then(async (res) => {
      const json = (await res.json()) as ApiResponse<{
        name: string;
        firstName?: string;
        lastName?: string;
        skillInterest?: string | null;
        city?: string | null;
        phoneLast4?: string;
      }>;
      if (!res.ok || !json.success) throw new Error(json.error ?? "Invalid invite");
      return json.data!;
    });
  },
  submit() {
    return regRequest<unknown>("/api/partner/register/submit", { method: "POST" }).then(async (d) => {
      await clearRegistrationToken();
      return d;
    });
  },
};

export { clearRegistrationToken, getRegistrationToken, setRegistrationToken };
