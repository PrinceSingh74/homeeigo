import { JWTService } from "@/services/jwt.service";

const jwt = new JWTService();

export interface WSAuthData {
  userId: string;
  userType: "customer" | "vendor" | "admin";
  email?: string;
}

export function verifyWSToken(token: string): WSAuthData | null {
  try {
    if (!token) {
      throw new Error("No token provided");
    }

    const decoded = jwt.verifyAccessToken(token);
    if (!decoded || !decoded.userId) {
      throw new Error("Invalid token payload");
    }

    return {
      userId: decoded.userId,
      userType: decoded.userType ?? "customer",
      email: decoded.email,
    };
  } catch (error) {
    console.error("[WSAuth] Token verification failed:", error);
    return null;
  }
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

export function attachAuthToWS(ws: any): WSAuthData | null {
  try {
    const token = extractWSToken(ws);
    if (!token) {
      console.warn("[WSAuth] No token provided in WebSocket connection");
      return null;
    }

    const authData = verifyWSToken(token);
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
