import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthRoute, isProtectedRoute } from "@/lib/auth/routes";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { resolveApiBase } from "@/lib/api-base";
import { isPublishedServiceSlug, servicesRouteVerdict } from "@/lib/catalog/services-route-guard";

/**
 * A path no route matches. Next renders app/not-found.tsx for it with a real 404 — the only way to get
 * one past the root loading.tsx boundary (see lib/catalog/services-route-guard.ts). The browser keeps
 * the URL it asked for; only the status and body change.
 */
const NOT_FOUND_TARGET = "/__not_found__";

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
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/services/")) {
    const verdict = servicesRouteVerdict(pathname);
    if (verdict === "not-found") return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url), { status: 404 });
    if (verdict !== "ok") {
      // null = backend unreadable → fail open; the page renders as before rather than 404 a real service.
      const published = await isPublishedServiceSlug(verdict.slug, resolveApiBase().replace(/\/$/, ""));
      if (published === false) return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url), { status: 404 });
    }
  }

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
    "/((?!api/|_next/static|_next/image|favicon.ico|icons|images|manifest.json|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)).*)",
  ],
};
