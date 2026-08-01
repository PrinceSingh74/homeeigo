/**
 * Derive the client IP for rate limiting and audit logs.
 * X-Forwarded-For is only trusted when TRUST_PROXY=true (Cloud Run / load balancer).
 * Direct dev connections ignore spoofable XFF headers.
 */
export function getClientIp(request: Request): string {
  const trustProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.TRUST_PROXY === "1" ||
    process.env.NODE_ENV === "production";

  if (trustProxy) {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown"
    );
  }

  return request.headers.get("x-real-ip") || "127.0.0.1";
}
