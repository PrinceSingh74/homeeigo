"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";
import { buildLoginUrl, isAuthRoute, isProtectedRoute } from "@/lib/auth/routes";
import { useAuthStore } from "@/stores/auth-store";

function AuthGuardFallback() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center">
      <AuroraBackground />
      <Loader2 className="relative z-10 size-8 animate-spin text-primary" aria-label="Loading" />
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  const isInitializing = status === "initializing" || status === "idle";
  const isAuthenticated = status === "authenticated" && !!user;
  const protectedRoute = isProtectedRoute(pathname);
  const authRoute = isAuthRoute(pathname);

  useEffect(() => {
    if (isInitializing) return;

    if (protectedRoute && !isAuthenticated) {
      const returnUrl = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
      router.replace(buildLoginUrl(returnUrl));
      return;
    }

    if (authRoute && isAuthenticated) {
      const returnUrl = searchParams?.get("returnUrl");
      router.replace(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/");
    }
  }, [isInitializing, isAuthenticated, protectedRoute, authRoute, pathname, router, searchParams]);

  if (isInitializing && (protectedRoute || authRoute)) {
    return <AuthGuardFallback />;
  }

  if (!isInitializing && protectedRoute && !isAuthenticated) {
    return <AuthGuardFallback />;
  }

  return <>{children}</>;
}
