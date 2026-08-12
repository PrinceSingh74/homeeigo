import React from "react";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { OfflineSyncBridge } from "@/components/app/OfflineSyncBridge";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <OfflineSyncBridge />
        {children}
      </AuthProvider>
    </QueryProvider>
  );
}
