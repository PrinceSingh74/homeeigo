/** Routes that require a signed-in customer */
export const PROTECTED_ROUTE_PREFIXES = [
  "/bookings",
  "/wallet",
  "/profile",
  "/book",
  "/notifications",
  "/settings",
  "/referrals",
  "/membership",
] as const;

export const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-otp",
  "/auth/google/callback",
  "/auth/apple/callback",
] as const;

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function buildLoginUrl(returnUrl?: string): string {
  if (!returnUrl || returnUrl.startsWith("/login")) return "/login";
  return `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}
