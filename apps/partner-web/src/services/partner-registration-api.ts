import { apiRequest } from "@/lib/api-client";
import { setRegistrationToken } from "@/lib/registration-session";
import type { OnboardingProgressPayload } from "@/lib/onboarding-resume";
import type { ApiResponse } from "@/types/partner";
export type RegistrationStep1Result = {
  userId: string;
  email: string;
  phoneNumber: string;
  step: number;
  nextStep: string;
  devOtp?: string;
};

export type AssessmentQuestion = {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
};

export type AssessmentPayload = {
  skillSlug: string;
  passScore: number;
  questions: AssessmentQuestion[];
};

export type AssessmentResult = {
  id?: string;
  skillSlug: string;
  status: string;
  score: number;
  maxScore: number;
  passed: boolean;
  correctCount: number;
  total: number;
  attempts?: number;
};

export type UploadedOnboardingDocument = {
  id: string;
  documentType: string;
  documentName: string;
  uploadStatus: string;
  isVerified: boolean;
};

export type OnboardingServiceOption = {
  id: string;
  label: string;
  catalogCategories: string[];
  requiredSkills?: string[];
  trainingRequired?: boolean;
  certifications?: string[];
};

export const partnerRegistrationApi = {
  serviceOptions() {
    return apiRequest<ApiResponse<{ source: string; options: OnboardingServiceOption[] }>>(
      "/api/partner/register/service-options",
    ).then((r) => r.data!);
  },

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

  async verifyOtp(body: { email: string; otp: string; userId: string; inviteToken?: string; referralCode?: string }) {
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

  getProgress() {
    return apiRequest<ApiResponse<OnboardingProgressPayload>>("/api/partner/onboarding/progress", {
      registration: true,
    }).then((r) => r.data!);
  },

  resumeApplication(body: { email: string; password: string }) {
    return apiRequest<
      ApiResponse<
        // An account that stopped before the OTP answers with `nextStep: "verify-otp"` (a new OTP
        // was sent) and none of the progress fields.
        Partial<OnboardingProgressPayload> & {
          userId: string;
          email: string;
          registrationToken?: string;
          nextStep?: string;
          devOtp?: string;
        }
      >
    >("/api/partner/register/resume", { method: "POST", body }).then((r) => {
      if (r.data?.registrationToken) setRegistrationToken(r.data.registrationToken);
      return r.data!;
    });
  },
  saveProfile(body: {
    dateOfBirth?: string;
    gender?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    bio?: string;
  }) {
    return apiRequest<ApiResponse<unknown>>("/api/partner/onboarding/profile", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },

  saveSkills(body: {
    primarySkill: string;
    secondarySkills?: string[];
    experienceYears: number;
    certifications?: string[];
  }) {
    return apiRequest<ApiResponse<unknown>>("/api/partner/onboarding/skills", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },

  saveLocation(body: {
    city: string;
    serviceRegions: string[];
    serviceRadiusKm: number;
    baseLatitude?: number;
    baseLongitude?: number;
  }) {
    return apiRequest<ApiResponse<unknown>>("/api/partner/onboarding/location", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },

  saveAvailability(body: {
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: string[];
  }) {
    return apiRequest<ApiResponse<unknown>>("/api/partner/onboarding/availability", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },

  runAssessment(body: { skillSlug: string; answers: Record<string, string> }) {
    return apiRequest<ApiResponse<AssessmentResult>>("/api/partner/onboarding/assessment", {
      method: "POST",
      body,
      registration: true,
    }).then((r) => r.data!);
  },

  getAssessment(skill?: string) {
    return apiRequest<ApiResponse<AssessmentPayload>>("/api/partner/onboarding/assessment", {
      registration: true,
      query: skill ? { skill } : undefined,
    }).then((r) => r.data!);
  },

  completeDocuments(uploadedTypes: string[]) {
    return apiRequest<ApiResponse<unknown>>("/api/partner/onboarding/documents", {
      method: "POST",
      body: { uploadedTypes },
      registration: true,
    }).then((r) => r.data!);
  },

  listDocuments() {
    return apiRequest<ApiResponse<{ documents: UploadedOnboardingDocument[] }>>(
      "/api/partner/documents",
      { registration: true },
    ).then((r) => r.data?.documents ?? []);
  },

  getInvite(token: string) {
    return apiRequest<
      ApiResponse<{
        leadId: string;
        name: string;
        firstName?: string;
        lastName?: string;
        skillInterest?: string | null;
        city?: string | null;
        phoneLast4?: string;
      }>
    >("/api/partner/register/invite", { query: { token } }).then((r) => r.data!);
  },

  getRegistrationStatus() {
    return apiRequest<
      ApiResponse<{
        status: string;
        message: string;
        rejectionReason?: string | null;
      }>
    >("/api/partner/registration-status", { registration: true }).then((r) => r.data!);
  },

  getTraining() {
    return apiRequest<ApiResponse<OnboardingTrainingPayload>>("/api/partner/onboarding/training", {
      registration: true,
    }).then((r) => r.data!);
  },

  completeTrainingModule(moduleId: string) {
    return apiRequest<ApiResponse<OnboardingTrainingPayload>>(
      `/api/partner/onboarding/training/${moduleId}/complete`,
      { method: "POST", registration: true },
    ).then((r) => r.data!);
  },

  acknowledgeTraining() {
    return apiRequest<ApiResponse<OnboardingTrainingPayload>>("/api/partner/onboarding/training/acknowledge", {
      method: "POST",
      registration: true,
    }).then((r) => r.data!);
  },

  getReview() {
    return apiRequest<ApiResponse<OnboardingReviewPayload>>("/api/partner/onboarding/review", {
      registration: true,
    }).then((r) => r.data!);
  },

  acknowledgeReview() {
    return apiRequest<ApiResponse<OnboardingReviewPayload>>("/api/partner/onboarding/review/acknowledge", {
      method: "POST",
      registration: true,
    }).then((r) => r.data!);
  },

  geoConfig() {
    return apiRequest<ApiResponse<{ mapsConfigured: boolean }>>("/api/partner/onboarding/geo/config", {
      registration: true,
    }).then((r) => r.data!);
  },

  reverseGeocode(lat: number, lng: number) {
    return apiRequest<
      ApiResponse<{
        available: boolean;
        address: GeoAddress | null;
        coverageZones: Array<{ id: string; name: string; zoneType: string; city: string | null }>;
      }>
    >("/api/partner/onboarding/geo/reverse", {
      registration: true,
      query: { lat, lng },
    }).then((r) => r.data!);
  },

  searchLocation(q: string) {
    return apiRequest<ApiResponse<{ available: boolean; address: GeoAddress | null }>>(
      "/api/partner/onboarding/geo/search",
      { registration: true, query: { q } },
    ).then((r) => r.data!);
  },

  autocompleteLocation(q: string) {
    return apiRequest<
      ApiResponse<{
        available: boolean;
        predictions: Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>;
      }>
    >("/api/partner/onboarding/geo/autocomplete", {
      registration: true,
      query: { q },
    }).then((r) => r.data!);
  },

  placeDetails(placeId: string) {
    return apiRequest<ApiResponse<GeoAddress | null>>(`/api/partner/onboarding/geo/place/${placeId}`, {
      registration: true,
    }).then((r) => r.data ?? null);
  },
};

export type GeoAddress = {
  formattedAddress: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

export type OnboardingTrainingModule = {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  contentUrl?: string | null;
  body?: string | null;
  completedAt: string | null;
  score?: number | null;
  status: "NOT_STARTED" | "COMPLETED";
};

export type OnboardingTrainingPayload = {
  modules: OnboardingTrainingModule[];
  completedCount: number;
  requiredModules: number;
  remaining: number;
  requiredForActivation: boolean;
  trainingComplete: boolean;
  policy: string;
};

export type OnboardingReviewPayload = {
  sections: Array<{
    id: string;
    label: string;
    complete: boolean;
    summary: string | null;
  }>;
  canSubmit: boolean;
  submitBlockers: string[];
  training: OnboardingTrainingPayload;
};
