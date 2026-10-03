"use client";

import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

/**
 * `SUPER_ADMIN` returns a literal `"*"` sentinel from `rbacService.getPermissions()`
 * (backend/src/services/rbac.service.ts) rather than an enumerated resource:action list.
 */
const SUPER_ADMIN_SENTINEL = "*";

/**
 * Pure, side-effect-free: true if `permissions` (from `rbac.me()`, e.g. `["PAYMENTS:READ", ...]`
 * or the `["*"]` SUPER_ADMIN sentinel) grants ANY action on ANY of `resources`. Exported
 * separately from the hook so it can be unit-tested without a React/query-client context.
 */
export function hasAnyResourcePermission(permissions: readonly string[], resources: readonly string[]): boolean {
  if (permissions.includes(SUPER_ADMIN_SENTINEL)) return true;
  return permissions.some((p) => resources.includes(p.split(":")[0] ?? ""));
}

export function useAdminPermissions() {
  const query = useQuery({
    queryKey: ["admin", "rbac-me"],
    queryFn: () => adminApi.rbac.me(),
    staleTime: 300_000,
    retry: false,
  });

  const permissions = query.data?.permissions ?? [];
  const isSuperAdmin = permissions.includes(SUPER_ADMIN_SENTINEL);

  return {
    role: query.data?.role,
    permissions,
    isSuperAdmin,
    hasAnyResource: (resources: readonly string[]) => hasAnyResourcePermission(permissions, resources),
    /**
     * Still loading or the RBAC call failed. Nav filtering fails OPEN on this (shows every
     * section) rather than closed — this list is a discoverability aid, not the security
     * boundary; every route it links to enforces its own real permission check server-side
     * regardless of what the sidebar shows.
     */
    isUnresolved: query.isLoading || query.isError,
  };
}
