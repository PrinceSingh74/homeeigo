"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePartnerStore } from "@/stores/partner-store";

const PUBLIC = ["/login", "/register", "/registration-success"];

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center partner-mesh">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-partner-primary border-t-transparent" />
    </div>
  );
}

export function PartnerAuthGuard({ children }: { children: React.ReactNode }) {
  const status = usePartnerStore((s) => s.status);
  const user = usePartnerStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const isAuthenticated = status === "authenticated" && !!user;
  const isInitializing = status === "idle" || status === "initializing";

  useEffect(() => {
    if (isInitializing) return;
    if (!isAuthenticated && !isPublic) router.replace("/login");
    if (isAuthenticated && isPublic) router.replace("/");
  }, [isAuthenticated, isInitializing, isPublic, router]);

  if (isInitializing && !isPublic) return <FullScreenSpinner />;
  if (!isAuthenticated && !isPublic) return <FullScreenSpinner />;

  return <>{children}</>;
}
