"use client";

import { useMemo } from "react";
import { GlassModal } from "@/components/acquisition/GlassModal";
import type { PartnerLeadListQuery, PartnerLeadSource } from "@/services/admin-api";

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

export type LeadAdvancedFilters = {
  source?: PartnerLeadSource;
  city?: string;
  assignedTo?: string;
  skill?: string;
  zone?: string;
  campaign?: string;
  minScore?: string;
  maxScore?: string;
  createdFrom?: string;
  createdTo?: string;
  lastActivityFrom?: string;
  lastActivityTo?: string;
};

export function LeadFilterDrawer({
  open,
  value,
  assignees,
  onChange,
  onApply,
  onReset,
  onClose,
}: {
  open: boolean;
  value: LeadAdvancedFilters;
  assignees: Array<{ id: string; label: string }>;
  onChange: (next: LeadAdvancedFilters) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const applied = useMemo(() => countApplied(value), [value]);

  return (
    <GlassModal
      open={open}
      title="Advanced filters"
      subtitle={applied ? `${applied} filters applied` : "Combine source, city, assignee, skill, and dates."}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex justify-between gap-2">
          <button type="button" onClick={onReset} className="rounded-xl px-4 py-2 text-sm font-semibold">
            Reset
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-[#05070d]"
          >
            Apply
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Source"
          value={value.source ?? ""}
          options={[{ id: "", label: "Any source" }, ...SOURCES.map((s) => ({ id: s, label: s.replace(/_/g, " ") }))]}
          onChange={(v) => onChange({ ...value, source: (v || undefined) as PartnerLeadSource | undefined })}
        />
        <TextField label="City" value={value.city ?? ""} onChange={(city) => onChange({ ...value, city: city || undefined })} />
        <SelectField
          label="Assignee"
          value={value.assignedTo ?? ""}
          options={[{ id: "", label: "Anyone" }, ...assignees]}
          onChange={(v) => onChange({ ...value, assignedTo: v || undefined })}
        />
        <TextField label="Skill" value={value.skill ?? ""} onChange={(skill) => onChange({ ...value, skill: skill || undefined })} />
        <TextField label="Zone" value={value.zone ?? ""} onChange={(zone) => onChange({ ...value, zone: zone || undefined })} />
        <TextField
          label="Campaign"
          value={value.campaign ?? ""}
          onChange={(campaign) => onChange({ ...value, campaign: campaign || undefined })}
        />
        <TextField
          label="Min score"
          type="number"
          value={value.minScore ?? ""}
          onChange={(minScore) => onChange({ ...value, minScore: minScore || undefined })}
        />
        <TextField
          label="Max score"
          type="number"
          value={value.maxScore ?? ""}
          onChange={(maxScore) => onChange({ ...value, maxScore: maxScore || undefined })}
        />
        <TextField
          label="Created from"
          type="date"
          value={value.createdFrom ?? ""}
          onChange={(createdFrom) => onChange({ ...value, createdFrom: createdFrom || undefined })}
        />
        <TextField
          label="Created to"
          type="date"
          value={value.createdTo ?? ""}
          onChange={(createdTo) => onChange({ ...value, createdTo: createdTo || undefined })}
        />
        <TextField
          label="Last activity from"
          type="date"
          value={value.lastActivityFrom ?? ""}
          onChange={(lastActivityFrom) => onChange({ ...value, lastActivityFrom: lastActivityFrom || undefined })}
        />
        <TextField
          label="Last activity to"
          type="date"
          value={value.lastActivityTo ?? ""}
          onChange={(lastActivityTo) => onChange({ ...value, lastActivityTo: lastActivityTo || undefined })}
        />
      </div>
    </GlassModal>
  );
}

export function toListQuery(filters: LeadAdvancedFilters): PartnerLeadListQuery {
  return {
    source: filters.source,
    city: filters.city,
    assignedTo: filters.assignedTo,
    skill: filters.skill,
    zone: filters.zone,
    campaign: filters.campaign,
    minScore: filters.minScore ? Number(filters.minScore) : undefined,
    maxScore: filters.maxScore ? Number(filters.maxScore) : undefined,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
    lastActivityFrom: filters.lastActivityFrom,
    lastActivityTo: filters.lastActivityTo,
  };
}

export function countApplied(filters: LeadAdvancedFilters) {
  return Object.values(filters).filter((v) => Boolean(v)).length;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
