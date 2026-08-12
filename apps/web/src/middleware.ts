import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthRoute, isProtectedRoute } from "@/lib/auth/routes";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/**
 * Server-side route protection. Runs before any page is rendered, so
 * protected content never flashes for signed-out visitors and auth pages
 * never flash for signed-in users.
 *
 * The marker cookie only signals "a session exists in this browser" — actual
 * token validation happens in the backend on every API request, and the
 * client AuthGuard remains as a second enforcement layer (e.g. for expired
 * sessions where the marker is stale).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isProtectedRoute(pathname) && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute(pathname) && hasSession) {
    // OAuth callbacks must complete even with an existing session.
    if (pathname.startsWith("/auth/")) return NextResponse.next();
    const returnUrl = request.nextUrl.searchParams.get("returnUrl");
    const target = returnUrl && returnUrl.startsWith("/") ? returnUrl : "/";
    return NextResponse.redirect(new URL(target, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next.js internals:
     * - _next/static, _next/image (build output)
     * - favicon, icons, images, manifest
     */
    "/((?!_next/static|_next/image|favicon.ico|icons|images|manifest.json|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)).*)",
  ],
};
