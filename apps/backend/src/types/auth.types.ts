export type TokenType = "access" | "refresh";

export type JwtPayload = {
  userId: string;
  email?: string;
  type: TokenType;
  iat?: number;
  exp?: number;
};

export type AuthErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "EMAIL_EXISTS"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ACCOUNT_BANNED"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export type AuthResponse<T = Record<string, unknown>> = {
  success: boolean;
  error?: string;
  code?: AuthErrorCode;
  data?: T;
};
