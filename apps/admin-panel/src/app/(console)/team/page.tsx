"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { DataTable } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi } from "@/services/admin-api";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type Role = { id: string; name: string; description?: string };
type AdminRow = {
  id: string;
  grantedAt?: string;
  role?: { id: string; name: string };
  user?: { id: string; email: string; firstName?: string | null; lastName?: string | null };
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Request failed");

/**
 * Team & roles — grant, change and revoke admin roles through /api/admin/rbac/*.
 *
 * The server is the authority (ADMIN_USERS permission, self-grant refused, only a SUPER_ADMIN may
 * grant or remove SUPER_ADMIN, the last SUPER_ADMIN cannot be removed). This page only presents
 * those rules; every refusal shows the server's reason.
 */
export default function TeamPage() {
  const qc = useQueryClient();
  const perms = useAdminPermissions();
  const canManage = perms.isUnresolved || perms.hasAnyResource(["ADMIN_USERS"]);

  const rolesQ = useQuery({ queryKey: ["admin", "rbac", "roles"], queryFn: () => adminApi.rbac.roles(), enabled: canManage });
  const adminsQ = useQuery({ queryKey: ["admin", "rbac", "admins"], queryFn: () => adminApi.rbac.admins(), enabled: canManage });
  const roles = (rolesQ.data?.roles ?? []) as unknown as Role[];
  const admins = useMemo(() => (adminsQ.data?.admins ?? []) as unknown as AdminRow[], [adminsQ.data]);

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const usersQ = useQuery({
    queryKey: ["admin", "team", "user-search", debounced],
    queryFn: () => adminApi.listUsers({ search: debounced, limit: 8 }),
    enabled: canManage && debounced.trim().length >= 3,
  });

  const [grant, setGrant] = useState<{ userId: string; label: string; roleId: string; converts: boolean } | null>(null);
  const [revoke, setRevoke] = useState<AdminRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "rbac"] });
  const grantMut = useMutation({
    mutationFn: (v: { userId: string; roleId: string }) => adminApi.rbac.grantRole(v.userId, v.roleId),
    onSuccess: () => { setGrant(null); setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const revokeMut = useMutation({
    mutationFn: (adminUserId: string) => adminApi.rbac.revokeRole(adminUserId),
    onSuccess: () => { setRevoke(null); setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  const adminUserIds = useMemo(() => new Set(admins.map((a) => a.user?.id)), [admins]);
  const rows = admins.map((a) => [
    <span key="n" className="font-semibold">{[a.user?.firstName, a.user?.lastName].filter(Boolean).join(" ") || "—"}</span>,
    a.user?.email ?? "—",
    <select
      key="r"
      aria-label={`Role for ${a.user?.email ?? "admin"}`}
      className="biz-input py-1"
      value={a.role?.id ?? ""}
      onChange={(e) => a.user && setGrant({ userId: a.user.id, label: a.user.email, roleId: e.target.value, converts: false })}
    >
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>,
    a.grantedAt ? new Date(a.grantedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—",
    <button key="x" type="button" className="biz-btn text-xs" onClick={() => setRevoke(a)}>
      <UserMinus size={13} /> Revoke
    </button>,
  ]);

  if (!canManage) {
    return (
      <PageShell eyebrow="Platform HQ" icon={ShieldCheck} title="Team & roles" subtitle="Admin access management">
        <p className="text-sm text-[var(--color-biz-muted)]">Your role does not include admin-user management (ADMIN_USERS).</p>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="Platform HQ" icon={ShieldCheck} title="Team & roles" subtitle="Grant, change and revoke admin access. Every change is audited server-side.">
      {error ? <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <DataTable
        headers={["Name", "Email", "Role", "Granted", ""]}
        isLoading={adminsQ.isLoading || rolesQ.isLoading}
        isError={adminsQ.isError}
        onRetry={() => void adminsQ.refetch()}
        emptyMessage="No active admins."
        rows={rows}
      />

      <section className="mt-8 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={15} /> Add an admin</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search an existing account by email (3+ characters)…"
          className="biz-input w-full max-w-md"
          aria-label="Search accounts"
        />
        <ul className="max-w-md space-y-1">
          {(usersQ.data?.users ?? []).filter((u) => !adminUserIds.has(u.id)).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-biz-line)] px-3 py-2 text-sm">
              <span className="truncate">{u.email}</span>
              <select
                aria-label={`Grant a role to ${u.email}`}
                className="biz-input py-1"
                defaultValue=""
                onChange={(e) => e.target.value && setGrant({ userId: u.id, label: u.email, roleId: e.target.value, converts: true })}
              >
                <option value="" disabled>Grant role…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={grant != null}
        title="Change admin access"
        description={
          grant
            ? `${grant.label} → ${roles.find((r) => r.id === grant.roleId)?.name ?? "role"}.` +
              (grant.converts ? " This converts the account into an ADMIN account; it will no longer sign in to the customer app." : "")
            : ""
        }
        confirmLabel="Grant role"
        isLoading={grantMut.isPending}
        onConfirm={() => { if (grant) grantMut.mutate({ userId: grant.userId, roleId: grant.roleId }); }}
        onClose={() => setGrant(null)}
      />
      <ConfirmDialog
        open={revoke != null}
        title="Revoke admin access"
        description={revoke ? `${revoke.user?.email ?? "This admin"} loses console access immediately and is signed out.` : ""}
        confirmLabel="Revoke"
        destructive
        isLoading={revokeMut.isPending}
        onConfirm={() => { if (revoke) revokeMut.mutate(revoke.id); }}
        onClose={() => setRevoke(null)}
      />
    </PageShell>
  );
}
