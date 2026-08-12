"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Pencil, Plus, Power, Search, Star, Trash2, X } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useAdminServicesQuery,
  useCreateServiceMutation,
  useDeleteServiceMutation,
  useSetServiceStatusMutation,
  useUpdateServiceMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { inr, formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import type { AdminServiceRow, ServiceInput } from "@/services/admin-api";

const PAGE_SIZE = 20;

type FormState = {
  name: string;
  category: string;
  basePrice: string;
  estimatedDuration: string;
  description: string;
  subcategory: string;
  icon: string;
  isFeatured: boolean;
  isActive: boolean;
};

function toForm(s?: AdminServiceRow): FormState {
  return {
    name: s?.name ?? "",
    category: s?.category ?? "",
    basePrice: s ? String(s.basePrice) : "",
    estimatedDuration: s ? String(s.estimatedDuration) : "60",
    description: s?.description ?? "",
    subcategory: s?.subcategory ?? "",
    icon: s?.icon ?? "",
    isFeatured: s?.isFeatured ?? false,
    isActive: s?.isActive ?? true,
  };
}

function ServiceFormModal({
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  initial?: AdminServiceRow;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ServiceInput) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const isEdit = !!initial;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    onSubmit({
      name: form.name.trim(),
      category: form.category.trim().toLowerCase(),
      basePrice: Number(form.basePrice),
      estimatedDuration: Number(form.estimatedDuration),
      description: form.description.trim(),
      subcategory: form.subcategory.trim() || undefined,
      icon: form.icon.trim() || undefined,
      isFeatured: form.isFeatured,
      isActive: form.isActive,
    });
  };

  const valid =
    form.name.trim().length >= 2 &&
    form.category.trim().length >= 1 &&
    Number(form.basePrice) > 0 &&
    Number(form.estimatedDuration) >= 1 &&
    form.description.trim().length >= 2;

  const field =
    "w-full rounded-lg border border-[var(--color-biz-border)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Edit service" : "New service"}</h2>
          <button onClick={onClose} className="text-[var(--color-biz-muted)] hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs font-medium text-[var(--color-biz-muted)]">
            Name
            <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Deep Cleaning" />
          </label>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Category
            <input className={field} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="cleaning" />
          </label>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Subcategory (optional)
            <input className={field} value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Base price (₹)
            <input className={field} type="number" min={0} value={form.basePrice} onChange={(e) => set("basePrice", e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Duration (mins)
            <input className={field} type="number" min={1} value={form.estimatedDuration} onChange={(e) => set("estimatedDuration", e.target.value)} />
          </label>
          <label className="col-span-2 text-xs font-medium text-[var(--color-biz-muted)]">
            Description
            <textarea className={field} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <label className="col-span-2 text-xs font-medium text-[var(--color-biz-muted)]">
            Image URL
            <input
              className={field}
              value={form.icon}
              onChange={(e) => set("icon", e.target.value)}
              placeholder="https://…/service-image.jpg"
            />
          </label>
          {form.icon.trim() ? (
            <div className="col-span-2 flex items-center gap-3">
              <div
                className="h-16 w-16 shrink-0 rounded-lg bg-[var(--color-biz-bg)] bg-cover bg-center ring-1 ring-[var(--color-biz-border)]"
                style={{ backgroundImage: `url("${form.icon.trim()}")` }}
              />
              <span className="text-[11px] text-[var(--color-biz-muted)]">Image preview</span>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} />
            Featured
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            Active
          </label>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--color-biz-border)] px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create service"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [debouncedSearch, page, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminServicesQuery(params);
  const createMut = useCreateServiceMutation();
  const updateMut = useUpdateServiceMutation();
  const statusMut = useSetServiceStatusMutation();
  const deleteMut = useDeleteServiceMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminServiceRow | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminServiceRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const services = data?.services ?? [];
  const activeCount = services.filter((s) => s.isActive).length;
  const featuredCount = services.filter((s) => s.isFeatured).length;

  const openCreate = () => {
    setEditing(undefined);
    setFormError(null);
    setFormOpen(true);
  };
  const openEdit = (s: AdminServiceRow) => {
    setEditing(s);
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = async (input: ServiceInput) => {
    setFormError(null);
    try {
      if (editing) await updateMut.mutateAsync({ id: editing.id, body: input });
      else await createMut.mutateAsync(input);
      setFormOpen(false);
    } catch (e) {
      setFormError(getErrorMessage(e));
    }
  };

  const toggleStatus = async (s: AdminServiceRow) => {
    setActionError(null);
    try {
      await statusMut.mutateAsync({ id: s.id, isActive: !s.isActive });
    } catch (e) {
      setActionError(getErrorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setActionError(getErrorMessage(e));
      setDeleteTarget(null);
    }
  };

  const rows = services.map((s) => [
    <div key={`n-${s.id}`} className="flex items-center gap-2.5">
      <div
        className="h-9 w-9 shrink-0 rounded-md bg-[var(--color-biz-bg)] bg-cover bg-center ring-1 ring-[var(--color-biz-border)]"
        style={s.icon ? { backgroundImage: `url("${s.icon}")` } : undefined}
      />
      <div>
        <p className="text-sm font-medium">{s.name}</p>
        <p className="text-[11px] text-[var(--color-biz-muted)]">/{s.slug}</p>
      </div>
    </div>,
    <span key={`c-${s.id}`} className="text-sm capitalize">{s.category}</span>,
    <span key={`p-${s.id}`} className="text-sm">{inr(s.basePrice)}</span>,
    <span key={`d-${s.id}`} className="text-sm">{s.estimatedDuration}m</span>,
    <span key={`b-${s.id}`} className="text-sm">{formatNumber(s.bookingCount)}</span>,
    s.isFeatured ? (
      <span key={`f-${s.id}`} className="inline-flex items-center gap-1 text-amber-400">
        <Star size={13} className="fill-amber-400" /> Yes
      </span>
    ) : (
      <span key={`f-${s.id}`} className="text-[var(--color-biz-muted)]">—</span>
    ),
    <StatusBadge key={`s-${s.id}`} status={s.isActive ? "active" : "inactive"} />,
    <div key={`a-${s.id}`} className="flex items-center justify-end gap-1">
      <button title="Edit" onClick={() => openEdit(s)} className="rounded p-1.5 hover:bg-white/5">
        <Pencil size={15} />
      </button>
      <button
        title={s.isActive ? "Deactivate" : "Activate"}
        onClick={() => void toggleStatus(s)}
        className={`rounded p-1.5 hover:bg-white/5 ${s.isActive ? "text-amber-400" : "text-emerald-400"}`}
      >
        <Power size={15} />
      </button>
      <button title="Delete" onClick={() => setDeleteTarget(s)} className="rounded p-1.5 text-red-400 hover:bg-white/5">
        <Trash2 size={15} />
      </button>
    </div>,
  ]);

  return (
    <PageShell title="Services" subtitle="Create, edit, activate and remove the service catalog.">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Total services" value={formatNumber(data?.total ?? 0)} icon={LayoutGrid} />
        <KpiCard label="Active" value={formatNumber(activeCount)} icon={Power} />
        <KpiCard label="Featured" value={formatNumber(featuredCount)} icon={Star} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-biz-muted)]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search services…"
            className="w-full rounded-lg border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] py-2 pl-9 pr-3 text-sm outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as "all" | "active" | "inactive");
            setPage(1);
          }}
          className="rounded-lg border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> New service
        </button>
      </div>

      {actionError ? <p className="mt-3 text-sm text-red-400">{actionError}</p> : null}

      <div className="mt-4">
        <DataTable
          headers={["Service", "Category", "Price", "Duration", "Bookings", "Featured", "Status", ""]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No services found. Create your first one."
          rows={rows}
          footer={
            <Pagination
              page={data?.page ?? page}
              total={data?.total ?? 0}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              isFetching={isFetching}
            />
          }
        />
      </div>

      {formOpen ? (
        <ServiceFormModal
          initial={editing}
          saving={createMut.isPending || updateMut.isPending}
          error={formError}
          onClose={() => setFormOpen(false)}
          onSubmit={submitForm}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This permanently removes the service. Services with existing bookings cannot be deleted — deactivate them instead."
        confirmLabel="Delete"
        destructive
        isLoading={deleteMut.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </PageShell>
  );
}
