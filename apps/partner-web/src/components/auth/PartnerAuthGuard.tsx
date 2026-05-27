"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePartnerStore } from "@/stores/partner-store";

const PUBLIC = ["/login", "/register"];

export function PartnerAuthGuard({ children }: { children: React.ReactNode }) {
  const authenticated = usePartnerStore((s) => s.authenticated);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
    if (!authenticated && !isPublic) {
      router.replace("/login");
    }
    if (authenticated && pathname === "/login") {
      router.replace("/");
    }
  }, [authenticated, pathname, router]);

  if (!authenticated && !PUBLIC.some((p) => pathname.startsWith(p))) {
    return (
      <div className="flex min-h-dvh items-center justify-center partner-mesh">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-partner-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
