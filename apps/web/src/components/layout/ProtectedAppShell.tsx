"use client";

import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { AuthGuard } from "@/guards/AuthGuard";

export function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <AuthGuard>{children}</AuthGuard>
    </Suspense>
  );
}
