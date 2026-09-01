import { Elysia } from "elysia";
import { JWTService } from "../services/jwt.service";
import { tokenRevocationService } from "../services/token-revocation.service";
import prisma from "../lib/prisma";
import { incCounter } from "../lib/metrics";
import type { UserRole } from "@prisma/client";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { bindActorContext } from "../events/core/event-context";

const jwtService = new JWTService();

export type AuthUser = {
  userId: string;
  email?: string;
  role: UserRole;
  providerId?: string;
  isEmailVerified: boolean;
  isBanned: boolean;
  isActive: boolean;
};

export type ProviderAuthUser = AuthUser & { providerId: string };

export function createAuthPlugin(pluginName = "auth-plugin") {
  return new Elysia({ name: pluginName }).derive(
  { as: "scoped" },
  async ({ request, set }) => {
    let optional: { userId: string; email?: string } | null = null;
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.replace(/^Bearer\s+/i, "");
    const payload = bearer ? jwtService.verifyAccessToken(bearer) : null;
    // Security observability (P2): a presented-but-unverifiable bearer = invalid/expired/tampered JWT.
    if (bearer && !payload) incCounter("jwt_failures_total");
    if (payload?.userId) {
      const tokenValid = await tokenRevocationService.isAccessTokenValid(payload);
      if (tokenValid) {
        optional = { userId: payload.userId, email: payload.email };
      }
    }

    let authUser: AuthUser | null = null;
    if (optional?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: optional.userId },
        select: {
          id: true,
          email: true,
          role: true,
          isEmailVerified: true,
          isBanned: true,
          isActive: true,
          deletedAt: true,
          provider: { select: { id: true, registrationStatus: true, isApproved: true } },
        },
      });
      let partnerBlock: string | null = null;
      if (user?.role === "VENDOR") {
        partnerBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
      }
      if (user && !user.deletedAt && user.isActive && !user.isBanned && !partnerBlock) {
        authUser = {
          userId: user.id,
          email: user.email ?? undefined,
          role: user.role,
          providerId: user.provider?.id,
          isEmailVerified: user.isEmailVerified,
          isBanned: user.isBanned,
          isActive: user.isActive,
        };
        bindActorContext({
          actorId: user.id,
          actorType: user.role === "ADMIN" ? "admin" : user.role === "VENDOR" ? "partner" : "customer",
          partnerId: user.provider?.id,
        });
      }
    }

    const requireAuth = (): AuthUser => {
      if (!authUser) {
        if (optional?.userId) {
          set.status = 403;
          throw new Error("ACCOUNT_SUSPENDED");
        }
        set.status = 401;
        throw new Error("UNAUTHORIZED");
      }
      return authUser;
    };

    const requireVerifiedEmail = (): AuthUser => {
      const u = requireAuth();
      if (!u.isEmailVerified) {
        set.status = 403;
        throw new Error("EMAIL_NOT_VERIFIED");
      }
      return u;
    };

    const requireRole = (...roles: UserRole[]): AuthUser => {
      const u = requireAuth();
      if (!roles.includes(u.role)) {
        set.status = 403;
        incCounter("rbac_denied_total", { reason: "role_mismatch" });
        throw new Error("FORBIDDEN");
      }
      return u;
    };

    const requireProvider = (): ProviderAuthUser => {
      const u = requireAuth();
      if (!u.providerId) {
        set.status = 403;
        throw new Error("FORBIDDEN");
      }
      return { ...u, providerId: u.providerId };
    };

    return { authUser, requireAuth, requireVerifiedEmail, requireRole, requireProvider };
  },
  );
}

export const authPlugin = createAuthPlugin();
