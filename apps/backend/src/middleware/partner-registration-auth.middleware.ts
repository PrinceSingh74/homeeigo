import { partnerRegistrationSessionService, type RegistrationSessionContext } from "../services/partner-registration-session.service";

export function extractRegistrationToken(request: Request): string | null {
  const header = request.headers.get("x-registration-token");
  if (header?.trim()) return header.trim();
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export async function requireRegistrationSession(request: Request): Promise<RegistrationSessionContext> {
  const token = extractRegistrationToken(request);
  if (!token) throw new Error("FORBIDDEN:Registration token required");
  return partnerRegistrationSessionService.resolveSession(token);
}
