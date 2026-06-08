import { Elysia } from "elysia";
import { authMiddlewareInstance } from "../middleware/auth.middleware";
import prisma from "../lib/prisma";
import type { UserRole } from "@prisma/client";
import { partnerRegistrationService } from "../services/partner-registration.service";

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

export const authPlugin = new Elysia({ name: "auth-plugin" }).derive(
  { as: "scoped" },
  async ({ request, set }) => {
    const optional = authMiddlewareInstance.optionalAuth(request);
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
          email: user.email,
          role: user.role,
          providerId: user.provider?.id,
          isEmailVerified: user.isEmailVerified,
          isBanned: user.isBanned,
          isActive: user.isActive,
        };
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
