import { Elysia } from "elysia";
import { JWTService } from "../services/jwt.service";
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
  /** ADMIN users only: an ACTIVE AdminUser record exists (revocation flips it off). */
  adminActive?: boolean;
};

export type ProviderAuthUser = AuthUser & { providerId: string };

/** One row of the single authentication query below (snake_case: it is raw SQL, not a Prisma model). */
type AuthRow = {
  id: string | null;
  email: string | null;
  role: UserRole | null;
  is_email_verified: boolean | null;
  is_banned: boolean | null;
  is_active: boolean | null;
  deleted_at: Date | null;
  provider_id: string | null;
  admin_active: boolean | null;
  auth_epoch: number | null;
  token_revoked: boolean;
};

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

    let authUser: AuthUser | null = null;
    if (payload?.userId) {
      /**
       * One round trip for the whole authentication decision.
       *
       * This ran four queries per authenticated request: the user, then `providers` and
       * `admin_users` (Prisma issues a separate query per nested relation), then the jti blacklist,
       * then the auth epoch. Measured on the 2026-09-21 load profile, each showed 13,212 calls —
       * one per authenticated request — and every one of them costs a pool acquisition and an
       * event-loop round trip on the single Bun thread that is the real capacity limit here.
       *
       * Every join is on a UNIQUE key (providers_user_id_key, admin_users_user_id_key,
       * user_auth_epochs_pkey, token_blacklist_token_jti_key), so the LEFT JOINs cannot fan out and
       * the result is identical to what the four queries returned. The authorization LOGIC below is
       * unchanged — this moves where the facts come from, never what is done with them.
       */
      const rows = (await prisma
        .$queryRaw`
          SELECT u.id,
                 u.email,
                 u.role::text AS role,
                 u.is_email_verified,
                 u.is_banned,
                 u.is_active,
                 u.deleted_at,
                 p.id            AS provider_id,
                 a.is_active     AS admin_active,
                 e.epoch         AS auth_epoch,
                 EXISTS (SELECT 1 FROM token_blacklist tb WHERE tb.token_jti = ${payload.jti ?? ""}) AS token_revoked
          -- Driven off the claim, not off the users table, so exactly one row comes back even when
          -- the user no longer exists. That matters: a valid token for a deleted user must still
          -- answer the revocation question and end in 403 ACCOUNT_SUSPENDED, not 401.
          FROM (SELECT ${payload.userId}::text AS uid) q
          LEFT JOIN users u            ON u.id = q.uid
          LEFT JOIN providers p        ON p.user_id = u.id
          LEFT JOIN admin_users a      ON a.user_id = u.id
          LEFT JOIN user_auth_epochs e ON e.user_id = u.id`
        // Fail CLOSED, exactly as the previous `isTokenRevoked` did on a database error: an
        // unanswerable revocation question is treated as "not authenticated", never as "valid".
        // `null` (query threw) is therefore NOT the same as a row whose `id` is null (no such user).
        .catch(() => null)) as AuthRow[] | null;
      const row = rows?.[0] ?? null;

      // Revocation and auth epoch, evaluated exactly as tokenRevocationService.isAccessTokenValid
      // did: a legacy token carrying no authEpoch stays valid until its JWT exp, and the stored
      // epoch defaults to 0 when the user has no row.
      const epochOk =
        payload.authEpoch === undefined || payload.authEpoch >= (row?.auth_epoch ?? 0);
      const tokenValid = row !== null && !row.token_revoked && epochOk;
      if (tokenValid) {
        optional = { userId: payload.userId, email: payload.email };
      }

      let partnerBlock: string | null = null;
      if (tokenValid && row!.role === "VENDOR" && row!.id) {
        partnerBlock = await partnerRegistrationService.assertPartnerCanLogin(row!.id);
      }
      if (tokenValid && row && row.id && !row.deleted_at && row.is_active && !row.is_banned && !partnerBlock) {
        authUser = {
          userId: row.id,
          email: row.email ?? undefined,
          role: row.role as UserRole,
          providerId: row.provider_id ?? undefined,
          isEmailVerified: Boolean(row.is_email_verified),
          isBanned: Boolean(row.is_banned),
          isActive: Boolean(row.is_active),
          adminActive: row.role === "ADMIN" ? Boolean(row.admin_active) : undefined,
        };
        bindActorContext({
          actorId: row.id,
          actorType: row.role === "ADMIN" ? "admin" : row.role === "VENDOR" ? "partner" : "customer",
          partnerId: row.provider_id ?? undefined,
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
      // An ADMIN-role user is an admin only while an ACTIVE AdminUser record exists — the same
      // boundary /api/admin enforces. Without this, a revoked admin (isActive=false, role still
      // ADMIN) kept every requireRole("ADMIN") route (geo, digital twin, coverage, AI tools…) for
      // the life of their refresh token, and a legacy role-only admin had them outright.
      if (u.role === "ADMIN" && !u.adminActive) {
        set.status = 403;
        incCounter("rbac_denied_total", { reason: "admin_record_inactive" });
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
