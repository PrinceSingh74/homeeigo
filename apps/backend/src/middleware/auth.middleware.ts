import { JWTService } from "../services/jwt.service";

export type AuthContextUser = { userId: string; email?: string };

export type ResponseSetter = { status?: number | string };

/**
 * Spec Part 9 — JWT verification helpers for Elysia handlers.
 */
export class AuthMiddleware {
  constructor(private readonly jwtService: JWTService) {}

  verifyToken(request: Request, set: ResponseSetter) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      set.status = 401;
      return { ok: false as const, error: "No authorization header" };
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = this.jwtService.verifyAccessToken(token);
    if (!payload) {
      set.status = 401;
      return { ok: false as const, error: "Invalid or expired token" };
    }
    return {
      ok: true as const,
      user: { userId: payload.userId, email: payload.email } satisfies AuthContextUser,
    };
  }

  requireAuth(request: Request, set: ResponseSetter): AuthContextUser {
    const result = this.verifyToken(request, set);
    if (!result.ok) throw new Error("UNAUTHORIZED");
    return result.user;
  }

  optionalAuth(request: Request): AuthContextUser | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return null;
    const payload = this.jwtService.verifyAccessToken(authHeader.replace(/^Bearer\s+/i, ""));
    if (!payload?.userId) return null;
    return { userId: payload.userId, email: payload.email };
  }
}

const defaultJwt = new JWTService();
export const authMiddlewareInstance = new AuthMiddleware(defaultJwt);
