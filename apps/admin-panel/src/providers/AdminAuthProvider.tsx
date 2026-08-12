"use client";

import { useEffect } from "react";
import { useAdminStore } from "@/stores/admin-store";
import { AdminRealtimeBridge } from "@/components/realtime/AdminRealtimeBridge";

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useAdminStore((s) => s.bootstrap);
  const status = useAdminStore((s) => s.status);

  useEffect(() => {
    if (status === "idle") {
      void bootstrap();
    }
  }, [bootstrap, status]);

  return (
    <>
      {children}
      <AdminRealtimeBridge />
    </>
  );
}
