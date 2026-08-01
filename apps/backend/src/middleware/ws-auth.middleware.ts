import { authenticateWsConnection, type WsConnectionAuth } from "../lib/ws-connection-auth";
import { JWTService } from "../services/jwt.service";

const jwt = new JWTService();

export type WSAuthData = WsConnectionAuth;

/** Legacy sync helper — signature/exp only; prefer authenticateWsConnection. */
export function verifyWSToken(token: string): { userId: string; userType: WSAuthData["userType"]; email?: string } | null {
  const decoded = jwt.verifyAccessToken(token);
  if (!decoded?.userId) return null;
  return {
    userId: decoded.userId,
    userType: decoded.userType ?? "customer",
    email: decoded.email,
  };
}

export function extractWSToken(ws: any): string | null {
  try {
    const authHeader =
      typeof ws.data?.headers?.authorization === "string"
        ? ws.data.headers.authorization
        : "";

    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, "");
    }

    const headerToken = ws.data?.query?.token || ws.data?.token;
    return headerToken || null;
  } catch (error) {
    console.error("[WSAuth] Token extraction failed:", error);
    return null;
  }
}

export async function attachAuthToWS(ws: any, endpoint = "unknown"): Promise<WSAuthData | null> {
  try {
    const authData = await authenticateWsConnection(ws, endpoint);
    if (!authData) {
      console.warn("[WSAuth] Invalid WebSocket token");
      return null;
    }

    ws.data = { ...ws.data, auth: authData };
    console.log(`[WSAuth] Authenticated: ${authData.userId} (${authData.userType})`);
    return authData;
  } catch (error) {
    console.error("[WSAuth] Authentication error:", error);
    return null;
  }
}
