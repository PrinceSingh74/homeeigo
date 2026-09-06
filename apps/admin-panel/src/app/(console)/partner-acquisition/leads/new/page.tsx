"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi, type PartnerLeadSource } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";

const SOURCES: PartnerLeadSource[] = [
  "APNA",
  "JOBHAI",
  "REFERRAL",
  "RWA",
  "CONTRACTOR",
  "LOCAL_SHOP",
  "DIRECT",
  "SOCIAL",
  "CAMPAIGN",
  "PARTNER_REFERRAL",
];

export default function NewPartnerLeadPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    source: "DIRECT" as PartnerLeadSource,
    skillInterest: "",
    city: "",
    zone: "",
    notes: "",
  });

  const create = useMutation({
    mutationFn: (forceCreate?: boolean) =>
      adminApi.partnerAcquisition.createLead({
        ...form,
        email: form.email || undefined,
        forceCreate,
      }),
    onSuccess: (lead) => router.push(`/partner-acquisition/leads/${lead.id}`),
    onError: async (err) => {
      const msg = getErrorMessage(err);
      if (msg.includes("duplicate") || msg.includes("DUPLICATE")) {
        const res = await adminApi.partnerAcquisition.checkDuplicates({
          phone: form.phone,
          email: form.email || undefined,
        });
        setDuplicates(res.matches.map((m) => ({ id: m.id, name: m.name, status: m.status })));
      }
      setError(msg);
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionHead as="h1" title="Add Lead" subtitle="Capture a new partner acquisition lead with source attribution." />

      <GlassPanel className="p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate(false);
          }}
        >
          <Field label="Full Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Source</span>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as PartnerLeadSource })}
              className="w-full rounded-xl border border-[var(--color-biz-line)] bg-white/80 px-3 py-2.5"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <Field label="Skill Interest" value={form.skillInterest} onChange={(v) => setForm({ ...form, skillInterest: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <Field label="Zone" value={form.zone} onChange={(v) => setForm({ ...form, zone: v })} />
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-[var(--color-biz-line)] bg-white/80 px-3 py-2.5"
            />
          </label>

          {duplicates.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">Possible existing partner found</p>
              <ul className="mt-2 space-y-1 text-amber-800">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    {d.name} · {d.status}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-3 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
                onClick={() => create.mutate(true)}
              >
                Continue with justification
              </button>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-xl bg-[var(--color-biz-primary)] py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : "Create Lead"}
          </button>
        </form>
      </GlassPanel>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--color-biz-line)] bg-white/80 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--color-biz-primary)]"
      />
    </label>
  );
}
