"use client";

import { AuthGuard } from "@/guards/AuthGuard";

export function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
