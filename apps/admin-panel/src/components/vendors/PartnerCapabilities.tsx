"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi, type AdminCapabilityKind, type AdminCapabilityRow } from "@/services/admin-api";
import { AdminApiError, getErrorMessage } from "@/lib/api-error";

type PendingAction = {
  kind: AdminCapabilityKind | "services";
  rowId: number | string;
  action: "verify" | "reject" | "revoke" | "approve" | "suspend";
  label: string;
};

const s = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
const d = (v: unknown): string => (v == null ? "—" : new Date(String(v)).toLocaleDateString());

/**
 * Phase 11 — provider capability review: every declared skill, certification, equipment item,
 * insurance policy and language with its computed validity, plus service capability and business
 * membership, and the append-only capability audit. Verification decisions happen here; a row a
 * database without the migration cannot serve renders as "not deployed", never as fake data.
 */
export function PartnerCapabilities({ providerId }: { providerId: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "provider-capabilities", providerId],
    queryFn: () => adminApi.capabilities.profile(providerId),
    enabled: !!providerId,
    staleTime: 10_000,
    retry: 1,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "provider-capabilities", providerId] });
    void qc.invalidateQueries({ queryKey: ["admin", "service-skills", providerId] });
  };

  const capMut = useMutation({
    mutationFn: (vars: { kind: AdminCapabilityKind; rowId: number; action: "verify" | "reject" | "revoke"; reason?: string }) =>
      adminApi.capabilities.transition(providerId, vars.kind, vars.rowId, vars.action, vars.reason),
    onSuccess: () => {
      setPending(null);
      refresh();
    },
  });

  const svcMut = useMutation({
    mutationFn: (vars: { serviceId: string; action: "approve" | "suspend" | "revoke"; reason?: string }) =>
      adminApi.serviceSkills.decide(providerId, vars.serviceId, vars.action, vars.reason),
    onSuccess: () => {
      setPending(null);
      refresh();
    },
  });

  const mutError = capMut.error ?? svcMut.error;
  const isMutating = capMut.isPending || svcMut.isPending;

  const confirm = (reason?: string) => {
    if (!pending) return;
    const needsReason = pending.action !== "verify" && pending.action !== "approve";
    if (needsReason && !reason) return;
    if (pending.kind === "services") {
      svcMut.mutate({ serviceId: String(pending.rowId), action: pending.action as "approve" | "suspend" | "revoke", reason });
    } else {
      capMut.mutate({ kind: pending.kind, rowId: Number(pending.rowId), action: pending.action as "verify" | "reject" | "revoke", reason });
    }
  };

  /** verify: DECLARED/REJECTED; reject: DECLARED; revoke: DECLARED/VERIFIED — mirrors adminTransition. */
  const rowActions = (kind: AdminCapabilityKind, row: AdminCapabilityRow, label: string) => {
    const status = String(row.status ?? "");
    const open = (action: "verify" | "reject" | "revoke") => setPending({ kind, rowId: row.id, action, label });
    if (kind === "languages") {
      return row.active ? (
        <button type="button" onClick={() => open("revoke")} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Deactivate language " + label}>
          Deactivate
        </button>
      ) : (
        "—"
      );
    }
    const buttons: React.ReactNode[] = [];
    if (status === "DECLARED" || status === "REJECTED") {
      buttons.push(
        <button key="v" type="button" onClick={() => open("verify")} className="rounded-lg border border-emerald-500/40 px-2 py-1 text-xs text-emerald-400" aria-label={"Verify " + label}>
          Verify
        </button>,
      );
    }
    if (status === "DECLARED") {
      buttons.push(
        <button key="j" type="button" onClick={() => open("reject")} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Reject " + label}>
          Reject
        </button>,
      );
    }
    if (status === "DECLARED" || status === "VERIFIED") {
      buttons.push(
        <button key="r" type="button" onClick={() => open("revoke")} className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-400" aria-label={"Revoke " + label}>
          Revoke
        </button>,
      );
    }
    return buttons.length ? <span className="flex flex-wrap gap-1">{buttons}</span> : "—";
  };

  const serviceActions = (row: AdminCapabilityRow, label: string) => {
    const status = String(row.status ?? "");
    const serviceId = String(row.serviceId ?? "");
    if (!serviceId) return "—";
    const open = (action: "approve" | "suspend" | "revoke") => setPending({ kind: "services", rowId: serviceId, action, label });
    const buttons: React.ReactNode[] = [];
    if (status === "REQUESTED" || status === "SUSPENDED") {
      buttons.push(
        <button key="a" type="button" onClick={() => open("approve")} className="rounded-lg border border-emerald-500/40 px-2 py-1 text-xs text-emerald-400" aria-label={"Approve service " + label}>
          Approve
        </button>,
      );
    }
    if (status === "ACTIVE") {
      buttons.push(
        <button key="s" type="button" onClick={() => open("suspend")} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Suspend service " + label}>
          Suspend
        </button>,
      );
    }
    if (status === "REQUESTED" || status === "ACTIVE" || status === "SUSPENDED") {
      buttons.push(
        <button key="r" type="button" onClick={() => open("revoke")} className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-400" aria-label={"Revoke service " + label}>
          Revoke
        </button>,
      );
    }
    return buttons.length ? <span className="flex flex-wrap gap-1">{buttons}</span> : "—";
  };

  const notDeployed = isError && error instanceof AdminApiError && (error.code === "NOT_DEPLOYED" || error.status === 503);

  return (
    <section className="biz-card space-y-4 p-5" data-testid="partner-capabilities">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-[var(--color-biz-accent)]" /> Capabilities
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-biz-muted)]">
            What this partner declared and what has been verified. Verify, reject or revoke each row; every decision is audited with your reason.
          </p>
        </div>
        {data ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5">pending review · {data.summary.pendingReview}</span>
            <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5">near expiry · {data.summary.nearExpiry}</span>
            <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5">expired · {data.summary.expired}</span>
          </div>
        ) : null}
      </div>

      {notDeployed ? (
        <p className="text-xs text-[var(--color-biz-muted)]">Capability profiles are not deployed on this database (migration 20260924223000)</p>
      ) : isError ? (
        <p className="text-sm text-red-400" role="alert">
          {getErrorMessage(error, "Could not load the capability profile")}{" "}
          <button type="button" onClick={() => void refetch()} className="underline">Retry</button>
        </p>
      ) : null}

      {mutError ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {getErrorMessage(mutError, "Action failed")}
        </p>
      ) : null}

      {!notDeployed ? (
        <>
          <DataTable
            title="Skills"
            headers={["Skill", "Level", "Status", "Validity", "Expires", "Verified by", "Action"]}
            rows={(data?.skills ?? []).map((r) => [
              s(r.skillName) + " (" + s(r.skillCode) + ")",
              s(r.level),
              <StatusBadge key={"sk-s-" + r.id} status={s(r.status)} />,
              <StatusBadge key={"sk-v-" + r.id} status={r.validity} />,
              d(r.expiresAt) + (r.nearExpiry ? " · near expiry" : ""),
              s(r.verifiedBy),
              rowActions("skills", r, String(r.skillName ?? r.skillCode ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No skills declared"
          />
          <DataTable
            title="Certifications"
            headers={["Certification", "Issuer", "Issued", "Expires", "Status", "Validity", "Action"]}
            rows={(data?.certifications ?? []).map((r) => [
              s(r.certificationType),
              s(r.issuer),
              d(r.issuedAt),
              d(r.expiresAt) + (r.nearExpiry ? " · near expiry" : ""),
              <StatusBadge key={"ce-s-" + r.id} status={s(r.status)} />,
              <StatusBadge key={"ce-v-" + r.id} status={r.validity} />,
              rowActions("certifications", r, String(r.certificationType ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No certifications declared"
          />
          <DataTable
            title="Equipment"
            headers={["Equipment", "Ownership", "Operational", "Inspection due", "Status", "Validity", "Action"]}
            rows={(data?.equipment ?? []).map((r) => [
              s(r.equipmentType),
              s(r.ownership),
              s(r.operational),
              d(r.inspectionDueAt) + (r.nearExpiry ? " · due soon" : ""),
              <StatusBadge key={"eq-s-" + r.id} status={s(r.status)} />,
              <StatusBadge key={"eq-v-" + r.id} status={r.validity} />,
              rowActions("equipment", r, String(r.equipmentType ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No equipment declared"
          />
          <DataTable
            title="Insurance"
            headers={["Insurance", "Insurer", "Effective from", "Expires", "Status", "Validity", "Action"]}
            rows={(data?.insurance ?? []).map((r) => [
              s(r.insuranceType),
              s(r.insurer),
              d(r.effectiveFrom),
              d(r.expiresAt) + (r.nearExpiry ? " · near expiry" : ""),
              <StatusBadge key={"in-s-" + r.id} status={s(r.status)} />,
              <StatusBadge key={"in-v-" + r.id} status={r.validity} />,
              rowActions("insurance", r, String(r.insuranceType ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No insurance declared"
          />
          <DataTable
            title="Languages"
            headers={["Language", "Proficiency", "Source", "Validity", "Action"]}
            rows={(data?.languages ?? []).map((r) => [
              s(r.languageCode),
              s(r.proficiency),
              s(r.source),
              <StatusBadge key={"la-v-" + r.id} status={r.validity} />,
              rowActions("languages", r, String(r.languageCode ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No languages declared"
          />
          <DataTable
            title="Service capability"
            headers={["Service", "Status", "Source", "Verified", "Action"]}
            rows={(data?.services ?? []).map((r) => [
              s(r.serviceName),
              <StatusBadge key={"sv-s-" + r.id} status={s(r.status)} />,
              s(r.source),
              r.verifiedAt ? d(r.verifiedAt) + (r.verifiedBy ? " · " + s(r.verifiedBy) : "") : "—",
              serviceActions(r, String(r.serviceName ?? r.serviceId ?? r.id)),
            ])}
            loading={isLoading}
            emptyMessage="No service capability rows"
          />
          <DataTable
            title="Business membership"
            headers={["Business", "Role", "Business status", "Period", "Validity"]}
            rows={(data?.memberships ?? []).map((m, i) => [
              s(m.businessId),
              s(m.role),
              <StatusBadge key={"bm-s-" + i} status={s(m.businessStatus)} />,
              d(m.effectiveFrom) + " → " + (m.effectiveTo == null ? "open" : d(m.effectiveTo)),
              <StatusBadge key={"bm-v-" + i} status={m.validity} />,
            ])}
            loading={isLoading}
            emptyMessage="Not a member of any business"
          />
          <DataTable
            title="Capability audit"
            headers={["When", "Table", "Row", "Action", "Actor", "Reason", "Request / trace"]}
            rows={(data?.audit ?? []).map((a) => [
              a.changedAt ? new Date(String(a.changedAt)).toLocaleString() : "—",
              s(a.tableName),
              s(a.rowId),
              s(a.action),
              s(a.actorType) + (a.actorId ? " " + String(a.actorId).slice(0, 10) + "…" : ""),
              s(a.reason),
              s(a.requestId) + " / " + s(a.traceId),
            ])}
            loading={isLoading}
            emptyMessage="No capability changes recorded"
          />
        </>
      ) : null}

      <ConfirmDialog
        open={pending != null}
        title={
          pending
            ? pending.action.charAt(0).toUpperCase() + pending.action.slice(1) + " " + pending.label
            : "Capability action"
        }
        description={
          pending?.action === "verify" || pending?.action === "approve"
            ? "Recorded in the capability audit with you as the verifier."
            : "Recorded in the capability audit. A reason is required."
        }
        confirmLabel={pending ? pending.action.charAt(0).toUpperCase() + pending.action.slice(1) : "Confirm"}
        destructive={pending?.action === "revoke" || pending?.action === "reject"}
        reasonLabel="Reason"
        reasonRequired={pending ? pending.action !== "verify" && pending.action !== "approve" : false}
        isLoading={isMutating}
        onClose={() => setPending(null)}
        onConfirm={confirm}
      />
    </section>
  );
}
