export type AuthUser = {
  id: string;
  email: string;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  role: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive?: boolean;
  isBanned?: boolean;
  createdAt?: string;
  walletBalance?: number;
  totalSpent?: number;
  referralCode?: string | null;
  referralCount?: number;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type ApiErrorCode =
  | "INVALID_CREDENTIALS"
  | "RATE_LIMIT_EXCEEDED"
  | "EMAIL_EXISTS"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ACCOUNT_BANNED"
  | "INTERNAL_ERROR";

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: ApiErrorCode;
  message?: string;
  details?: string[];
};

export type AuthSessionPayload = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type PendingRegistration = {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  password: string;
  referralCode?: string;
  agreeToTerms: true;
};

export type AuthStatus = "idle" | "initializing" | "authenticated" | "unauthenticated";
