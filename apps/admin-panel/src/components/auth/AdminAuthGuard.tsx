"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminStore } from "@/stores/admin-store";

const PUBLIC = ["/login"];

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const authenticated = useAdminStore((s) => s.authenticated);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
    if (!authenticated && !isPublic) router.replace("/login");
    if (authenticated && pathname === "/login") router.replace("/");
  }, [authenticated, pathname, router]);

  if (!authenticated && !PUBLIC.some((p) => pathname.startsWith(p))) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--color-biz-bg)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-biz-accent)] border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
