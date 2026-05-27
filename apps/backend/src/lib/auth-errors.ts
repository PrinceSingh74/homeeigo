import type { AuthErrorCode, AuthResponse } from "../types/auth.types";

export class AuthError extends Error {
  public readonly status: number;
  public readonly code: AuthErrorCode;

  constructor(message: string, status: number, code: AuthErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const authErrorResponse = (
  error: string,
  code: AuthErrorCode,
  requestId?: string
): AuthResponse => ({
  success: false,
  error,
  code,
  data: requestId ? { requestId } : undefined,
});
