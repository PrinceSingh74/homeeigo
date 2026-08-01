import type { UserRole } from "@prisma/client";
import { JWTService } from "../services/jwt.service";
import { tokenRevocationService } from "../services/token-revocation.service";
import { AuditLogService } from "../services/audit-log.service";
import prisma from "./prisma";
import { mapUserRoleToWsType } from "./ws-channel-access";

const jwtService = new JWTService();

export type WsConnectionAuth = {
  userId: string;
  userType: "customer" | "vendor" | "admin";
  userRole: UserRole;
  email?: string;
  jti?: string;
};

function extractBearer(ws: { data?: { headers?: Record<string, unknown>; query?: Record<string, unknown> } }): string {
  const authHeader =
    typeof ws.data?.headers?.authorization === "string" ? ws.data.headers.authorization : "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "");
  const queryToken = ws.data?.query?.token;
  return (typeof queryToken === "string" ? queryToken : "") || headerToken || "";
}

function extractWsNonce(ws: { data?: { headers?: Record<string, unknown>; query?: Record<string, unknown> } }): string | undefined {
  const headerNonce = ws.data?.headers?.["x-ws-nonce"];
  if (typeof headerNonce === "string" && headerNonce) return headerNonce;
  const queryNonce = ws.data?.query?.nonce;
  return typeof queryNonce === "string" && queryNonce ? queryNonce : undefined;
}

/**
 * Full WebSocket auth: signature, expiry, revocation, optional nonce, DB role lookup.
 */
export async function authenticateWsConnection(
  ws: { data?: { headers?: Record<string, unknown>; query?: Record<string, unknown> } },
  endpoint: string,
): Promise<WsConnectionAuth | null> {
  const token = extractBearer(ws);
  if (!token) return null;

  const payload = jwtService.verifyAccessToken(token);
  if (!payload?.userId) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp != null && payload.exp < now) {
    return null;
  }

  const valid = await tokenRevocationService.isAccessTokenValid(payload);
  if (!valid) {
    void AuditLogService.record("REVOKED_TOKEN_USED", "failure", {
      userId: payload.userId,
      details: { endpoint, transport: "websocket" },
    });
    return null;
  }

  const clientNonce = extractWsNonce(ws);
  if (payload.wsNonce && clientNonce && payload.wsNonce !== clientNonce) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true, isActive: true, isBanned: true, deletedAt: true },
  });
  if (!user || !user.isActive || user.isBanned || user.deletedAt) {
    return null;
  }

  void AuditLogService.record("WEBSOCKET_CONNECTED", "success", {
    userId: user.id,
    details: { endpoint, jti: payload.jti ? `${payload.jti.slice(0, 8)}…` : undefined },
  });

  return {
    userId: user.id,
    userRole: user.role,
    userType: mapUserRoleToWsType(user.role),
    email: user.email ?? undefined,
    jti: payload.jti,
  };
}

export async function denyWsChannel(
  auth: WsConnectionAuth,
  channel: string,
  action?: string,
): Promise<void> {
  void AuditLogService.record("WEBSOCKET_UNAUTHORIZED", "failure", {
    userId: auth.userId,
    details: { channel, action },
  });
}
