export type TokenType = "access" | "refresh";

export type UserTypeClaim = "customer" | "vendor" | "admin";

export type JwtPayload = {
  userId: string;
  email?: string;
  /** Unique token id — used for access-token blacklist on logout. */
  jti?: string;
  /** Bumped on password reset / force logout to invalidate all outstanding access tokens. */
  authEpoch?: number;
  /** Refresh-token rotation family (refresh tokens only). */
  familyId?: string;
  /** Optional WebSocket connect nonce (must match X-WS-Nonce when present). */
  wsNonce?: string;
  /**
   * Optional convenience claim — not all access tokens carry it, since the
   * canonical role lives in the DB. WebSocket handlers that need a strict
   * role must look it up via Prisma rather than trusting the token.
   */
  userType?: UserTypeClaim;
  /**
   * Device the token was minted for. Lets the backend identify the caller's
   * current session authoritatively (instead of trusting a client-sent param).
   */
  deviceId?: string;
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
