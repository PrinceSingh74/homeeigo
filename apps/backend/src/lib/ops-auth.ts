/** Gate operational endpoints (/metrics, /ready) in production. */
export function assertOpsAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const token = process.env.OPS_AUTH_TOKEN?.trim();
  if (!token) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === token) return true;

  const alt = request.headers.get("x-ops-token");
  return alt === token;
}
