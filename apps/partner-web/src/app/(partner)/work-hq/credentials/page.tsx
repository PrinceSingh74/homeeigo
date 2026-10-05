"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  BriefcaseBusiness,
  CalendarClock,
  CircleSlash,
  Clock,
  FileCheck2,
  Languages,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { cn } from "@/lib/cn";
import {
  canEdit,
  canToggleOperational,
  canWithdraw,
  capabilityErrorMessage,
  expiryHint,
  formatDay,
  humanizeCode,
  isLocked,
  isRequiredByServices,
  LANGUAGE_OPTIONS,
  LANGUAGE_PROFICIENCIES,
  languageName,
  PROFICIENCY_LABEL,
  requirementOptions,
  SKILL_LEVELS,
  SKILL_LEVEL_LABEL,
  STATUS_META,
  toCapabilityCode,
  toDateInput,
  type ExpiryHint,
  type StatusTone,
} from "@/lib/credentials";
import { partnerApi } from "@/services/partner-api";
import { useToastStore } from "@/stores/toast-store";
import type {
  CapabilityKind,
  CapabilityStatus,
  EquipmentOperational,
  EquipmentOwnership,
  LanguageProficiency,
  ProviderCapabilityProfile,
  ProviderCertificationRow,
  ProviderInsuranceRow,
  SkillLevel,
} from "@/types/partner";

/**
 * My credentials — the partner's side of Phase 11 capabilities
 * (`/api/providers/me/capabilities`). A partner DECLARES skills, certifications, equipment,
 * insurance and languages; an admin verifies them. The page offers only what the server allows
 * (see `lib/credentials.ts`) and the server decides again on every request: a verified row is
 * locked and answers 409 CAPABILITY_LOCKED.
 */

const KEY = ["partner", "capabilities"] as const;

/** Runs one write, then reports whether it succeeded so a form knows to reset itself. */
type Submit = (run: () => Promise<unknown>, done: string) => Promise<boolean>;

const inputClass =
  "mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-partner-bg px-3 text-sm text-partner-text outline-none focus-visible:border-partner-primary focus-visible:ring-2 focus-visible:ring-partner-primary/40";

const TONE_ICON_CLASS: Record<StatusTone, string> = {
  pending: "text-partner-warning",
  ok: "text-partner-success",
  bad: "text-partner-danger",
};
const STATUS_ICON: Record<CapabilityStatus, LucideIcon> = { DECLARED: Clock, VERIFIED: BadgeCheck, REJECTED: XCircle, REVOKED: Ban };

const OWNERSHIP_LABEL: Record<EquipmentOwnership, string> = { OWNED: "I own it", RENTED: "Rented", EMPLOYER: "Provided by my employer" };
const OPERATIONAL_LABEL: Record<EquipmentOperational, string> = { OPERATIONAL: "Working", OUT_OF_SERVICE: "Out of service" };

export default function PartnerCredentialsPage() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  const profile = useQuery({ queryKey: KEY, queryFn: () => partnerApi.capabilities.profile() });

  const write = useMutation({
    mutationFn: (v: { run: () => Promise<unknown>; done: string }) => v.run(),
    onSuccess: (_data, v) => showToast(v.done, "success"),
    onError: (e) => showToast(capabilityErrorMessage(e), "error"),
    // Refresh after a refusal too: a CAPABILITY_LOCKED answer means the row changed under us.
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const submit: Submit = (run, done) => write.mutateAsync({ run, done }).then(() => true, () => false);
  const busy = write.isPending;

  const data = profile.data;
  const statused = data ? [...data.skills, ...data.certifications, ...data.equipment, ...data.insurance] : [];

  return (
    <HqPageShell
      title="My Credentials"
      description="Verified credentials are what make you eligible for jobs that require them. Declare what you hold here; our team reviews each one before it counts."
      icon={BadgeCheck}
      loading={profile.isLoading}
      error={profile.isError ? capabilityErrorMessage(profile.error, "Could not load your credentials.") : null}
      onRetry={() => void profile.refetch()}
      stats={
        data
          ? [
              { label: "Verified", value: statused.filter((r) => r.status === "VERIFIED").length, hint: "Count towards job eligibility" },
              { label: "Awaiting review", value: statused.filter((r) => r.status === "DECLARED").length, hint: "Declared, not yet verified" },
              { label: "Expiring soon", value: data.summary.nearExpiry, hint: "Within 30 days" },
              { label: "Expired", value: data.summary.expired, hint: "No longer count" },
            ]
          : undefined
      }
    >
      {data ? (
        <div className="space-y-6" data-testid="credentials-page">
          <SkillsGroup data={data} busy={busy} submit={submit} />
          <CertificationsGroup data={data} busy={busy} submit={submit} />
          <EquipmentGroup data={data} busy={busy} submit={submit} />
          <InsuranceGroup data={data} busy={busy} submit={submit} />
          <LanguagesGroup data={data} busy={busy} submit={submit} />
        </div>
      ) : null}
    </HqPageShell>
  );
}

type GroupProps = { data: ProviderCapabilityProfile; busy: boolean; submit: Submit };

/* ------------------------------------------------------------------ shared pieces */

function Group({
  kind,
  title,
  icon: Icon,
  description,
  count,
  empty,
  addLabel,
  form,
  children,
}: {
  kind: CapabilityKind;
  title: string;
  icon: LucideIcon;
  description: string;
  count: number;
  empty: string;
  addLabel: string;
  /** The add form; `close` collapses it after a successful save. */
  form: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const headingId = `credentials-${kind}`;
  return (
    <section className="partner-card space-y-4 p-4 sm:p-6" aria-labelledby={headingId} data-testid={`credentials-${kind}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 font-display text-lg font-semibold text-partner-text">
            <Icon className="h-5 w-5 shrink-0 text-partner-primary" aria-hidden="true" />
            {title} <span className="text-sm font-normal text-partner-muted">({count})</span>
          </h2>
          <p className="mt-1 text-sm text-partner-muted">{description}</p>
        </div>
        <PartnerButton
          variant={adding ? "outline" : "primary"}
          className="min-h-11"
          aria-expanded={adding}
          aria-controls={`${headingId}-form`}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? null : <Plus className="h-4 w-4" aria-hidden="true" />}
          {adding ? "Cancel" : addLabel}
        </PartnerButton>
      </div>
      {adding ? (
        <div id={`${headingId}-form`} className="rounded-xl border border-partner-line p-4">
          {form(() => setAdding(false))}
        </div>
      ) : null}
      {count === 0 ? <p className="text-sm text-partner-muted">{empty}</p> : <ul className="grid gap-3">{children}</ul>}
    </section>
  );
}

function Badge({ icon: Icon, tone, children, title }: { icon: LucideIcon; tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-partner-line bg-partner-bg/60 px-2.5 py-1 text-xs font-semibold text-partner-text"
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE_ICON_CLASS[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: CapabilityStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge icon={STATUS_ICON[status]} tone={meta.tone} title={meta.explain}>
      <span data-testid="credential-status" data-status={status}>{meta.label}</span>
    </Badge>
  );
}

function ExpiryBadge({ hint }: { hint: ExpiryHint | null }) {
  if (!hint) return null;
  return <Badge icon={CalendarClock} tone={hint.tone}>{hint.label}</Badge>;
}

function Row({
  title,
  lines,
  badges,
  note,
  locked,
  actions,
  editor,
}: {
  title: string;
  lines: Array<string | null | false | undefined>;
  badges: ReactNode;
  /** The status in a sentence — why a row is rejected, revoked or waiting. */
  note?: string | null;
  locked: boolean;
  actions?: ReactNode;
  editor?: ReactNode;
}) {
  const shown = lines.filter((l): l is string => Boolean(l));
  return (
    <li className="rounded-xl border border-partner-line p-4" data-testid="credential-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-semibold text-partner-text">{title}</h3>
          {shown.map((l) => <p key={l} className="text-sm text-partner-text-secondary">{l}</p>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">{badges}</div>
      </div>
      {note ? <p className="mt-2 text-xs text-partner-muted">{note}</p> : null}
      {locked ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-partner-muted" data-testid="credential-locked">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Locked — reviewed by our team, so it cannot be edited or removed here.
        </p>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap items-end gap-2">{actions}</div> : null}
      {editor ? <div className="mt-3 rounded-xl border border-partner-line p-3">{editor}</div> : null}
    </li>
  );
}

function RemoveButton({ label, busy, onRemove }: { label: string; busy: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <PartnerButton variant="outline" className="min-h-11" disabled={busy} aria-label={`Remove ${label}`} onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Remove
      </PartnerButton>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm removing ${label}`}>
      <PartnerButton variant="danger" className="min-h-11" disabled={busy} onClick={onRemove}>Yes, remove</PartnerButton>
      <PartnerButton variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirming(false)}>Keep</PartnerButton>
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-partner-text">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-partner-muted">{hint}</span> : null}
    </label>
  );
}

const OTHER = "__other__";

/**
 * The credential's type. When services require specific codes (`options`), those are the primary
 * choice — eligibility matches on the exact code — and "Other…" opens free entry for something no
 * service asks for yet. With no options there is no picker, only free entry. A typed name is shown
 * with the code it is stored as, since the server keeps a code.
 */
function NameField({
  label,
  value,
  onChange,
  placeholder,
  options = [],
}: {
  label: string;
  /** A catalogue code, or the typed name (the form stores `toCapabilityCode(value)`). */
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options?: ReadonlyArray<{ code: string; label: string }>;
}) {
  const [choice, setChoice] = useState("");
  const code = toCapabilityCode(value);
  const free = options.length === 0 || choice === OTHER;
  const freeEntry = (fieldLabel: string) => (
    <Field label={fieldLabel} hint={value.trim() ? (code ? `Saved as: ${code}` : "Use letters and numbers.") : "Type the name as it appears on the document or item."}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={80} required className={inputClass} />
    </Field>
  );
  if (options.length === 0) return freeEntry(label);
  return (
    <>
      <Field label={label} hint="These are the ones our services ask for. Choose Other if yours is not listed.">
        <select
          value={choice}
          required
          onChange={(e) => {
            setChoice(e.target.value);
            onChange(e.target.value === OTHER ? "" : e.target.value);
          }}
          className={inputClass}
        >
          <option value="">Choose…</option>
          <optgroup label="Required by services">
            {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </optgroup>
          <option value={OTHER}>Other…</option>
        </select>
      </Field>
      {free ? freeEntry(`${label} (other)`) : null}
    </>
  );
}

/** Whether a service currently requires this row's code — from the server's catalogue only. */
function RequiredMark({ required }: { required: boolean | null }) {
  if (required === null) return null;
  return required ? (
    <Badge icon={BriefcaseBusiness} tone="ok" title="At least one service requires this. It counts once verified.">
      <span data-testid="credential-required" data-required="true">Required by services</span>
    </Badge>
  ) : (
    <Badge icon={CircleSlash} tone="pending" title="No service asks for this at the moment.">
      <span data-testid="credential-required" data-required="false">Not required by any service yet</span>
    </Badge>
  );
}

function FormActions({ busy, disabled, label }: { busy: boolean; disabled?: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
      <PartnerButton type="submit" className="min-h-11" disabled={busy || disabled}>{busy ? "Saving…" : label}</PartnerButton>
      <p className="text-xs text-partner-muted">Saved as &ldquo;Awaiting review&rdquo; until our team verifies it.</p>
    </div>
  );
}

const formClass = "grid gap-3 sm:grid-cols-2";
const text = (v: string) => (v.trim() ? v.trim() : null);

/* ------------------------------------------------------------------ skills */

function SkillsGroup({ data, busy, submit }: GroupProps) {
  const held = new Set(data.skills.map((s) => s.skillCode));
  const available = data.skillCatalogue.filter((s) => !held.has(s.code));
  const categories = Array.from(new Set(available.map((s) => s.category)));
  return (
    <Group
      kind="skills"
      title="Skills"
      icon={Sparkles}
      description="What you are trained to do. Choose from the skills our services use."
      count={data.skills.length}
      empty="No skills declared yet."
      addLabel="Add skill"
      form={(close) => (
        <SkillForm
          busy={busy}
          empty={available.length === 0}
          options={categories.map((c) => ({ category: c, skills: available.filter((s) => s.category === c) }))}
          onSubmit={async (skillCode, level) => {
            if (await submit(() => partnerApi.capabilities.declareSkill({ skillCode, level }), "Skill added — awaiting review")) close();
          }}
        />
      )}
    >
      {data.skills.map((s) => (
        <Row
          key={s.id}
          title={s.skillName}
          lines={[s.skillCategory, s.level ? `Level: ${SKILL_LEVEL_LABEL[s.level]}` : "Level not specified", !s.skillActive && "This skill is no longer offered in the catalogue."]}
          badges={<><StatusBadge status={s.status} /><ExpiryBadge hint={expiryHint(s)} /></>}
          note={s.status === "VERIFIED" ? null : STATUS_META[s.status].explain}
          locked={isLocked("skills", s)}
          actions={
            canEdit("skills", s) || canWithdraw("skills", s) ? (
              <>
                {canEdit("skills", s) ? (
                  <LevelEditor
                    label={`Level for ${s.skillName}`}
                    value={s.level}
                    busy={busy}
                    onSave={(level) => void submit(() => partnerApi.capabilities.declareSkill({ skillCode: s.skillCode, level }), "Skill level updated — awaiting review")}
                  />
                ) : null}
                {canWithdraw("skills", s) ? (
                  <RemoveButton label={s.skillName} busy={busy} onRemove={() => void submit(() => partnerApi.capabilities.withdraw("skills", s.id), "Skill removed")} />
                ) : null}
              </>
            ) : null
          }
        />
      ))}
    </Group>
  );
}

function SkillForm({
  busy,
  empty,
  options,
  onSubmit,
}: {
  busy: boolean;
  empty: boolean;
  options: Array<{ category: string; skills: Array<{ code: string; name: string }> }>;
  onSubmit: (skillCode: string, level: SkillLevel | null) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [level, setLevel] = useState<SkillLevel | "">("");
  if (empty) return <p className="text-sm text-partner-muted">Every skill in the catalogue is already on your list. New skills appear here when our team adds them.</p>;
  return (
    <form className={formClass} onSubmit={(e: FormEvent) => { e.preventDefault(); if (code) void onSubmit(code, level || null); }}>
      <Field label="Skill">
        <select value={code} onChange={(e) => setCode(e.target.value)} required className={inputClass}>
          <option value="">Choose a skill…</option>
          {options.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.skills.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Your level (optional)">
        <select value={level} onChange={(e) => setLevel(e.target.value as SkillLevel | "")} className={inputClass}>
          <option value="">Not specified</option>
          {SKILL_LEVELS.map((l) => <option key={l} value={l}>{SKILL_LEVEL_LABEL[l]}</option>)}
        </select>
      </Field>
      <FormActions busy={busy} disabled={!code} label="Add skill" />
    </form>
  );
}

function LevelEditor({ label, value, busy, onSave }: { label: string; value: SkillLevel | null; busy: boolean; onSave: (level: SkillLevel | null) => void }) {
  const [level, setLevel] = useState<SkillLevel | "">(value ?? "");
  const changed = (value ?? "") !== level;
  return (
    <span className="inline-flex flex-wrap items-end gap-2">
      <label className="text-xs text-partner-muted">
        Level
        <select aria-label={label} value={level} onChange={(e) => setLevel(e.target.value as SkillLevel | "")} className={cn(inputClass, "w-auto min-w-36")}>
          <option value="">Not specified</option>
          {SKILL_LEVELS.map((l) => <option key={l} value={l}>{SKILL_LEVEL_LABEL[l]}</option>)}
        </select>
      </label>
      <PartnerButton variant="outline" className="min-h-11" disabled={busy || !changed} onClick={() => onSave(level || null)}>Update level</PartnerButton>
    </span>
  );
}

/* ------------------------------------------------------------------ certifications */

function CertificationsGroup({ data, busy, submit }: GroupProps) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <Group
      kind="certifications"
      title="Certifications"
      icon={FileCheck2}
      description="Licences and certificates. Some services can only be offered to professionals with a verified certificate."
      count={data.certifications.length}
      empty="No certifications declared yet."
      addLabel="Add certification"
      form={(close) => (
        <CertificationForm
          busy={busy}
          options={requirementOptions(data.requirementCatalogue, "certifications")}
          submitLabel="Add certification"
          onSubmit={async (v) => {
            if (await submit(() => partnerApi.capabilities.declareCertification({ certificationType: toCapabilityCode(v.name), issuer: text(v.issuer), referenceNumber: text(v.reference), issuedAt: v.from || null, expiresAt: v.expires || null }), "Certification added — awaiting review")) close();
          }}
        />
      )}
    >
      {data.certifications.map((c) => {
        const name = humanizeCode(c.certificationType);
        return (
          <Row
            key={c.id}
            title={name}
            lines={[c.issuer && `Issued by ${c.issuer}`, c.referenceNumber && `Reference ${c.referenceNumber}`, c.issuedAt && `Issued ${formatDay(c.issuedAt)}`]}
            badges={<><StatusBadge status={c.status} /><ExpiryBadge hint={expiryHint(c)} /><RequiredMark required={isRequiredByServices(data.requirementCatalogue, "certifications", c.certificationType)} /></>}
            note={c.status === "REVOKED" && c.revokedReason ? `Revoked: ${c.revokedReason}` : c.status === "VERIFIED" ? null : STATUS_META[c.status].explain}
            locked={isLocked("certifications", c)}
            actions={
              canEdit("certifications", c) || canWithdraw("certifications", c) ? (
                <>
                  {canEdit("certifications", c) ? (
                    <PartnerButton variant="outline" className="min-h-11" disabled={busy} aria-expanded={editing === c.id} aria-label={`Edit ${name}`} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      {editing === c.id ? "Close" : "Edit"}
                    </PartnerButton>
                  ) : null}
                  {canWithdraw("certifications", c) ? (
                    <RemoveButton label={name} busy={busy} onRemove={() => void submit(() => partnerApi.capabilities.withdraw("certifications", c.id), "Certification removed")} />
                  ) : null}
                </>
              ) : null
            }
            editor={
              editing === c.id ? (
                <CertificationForm
                  busy={busy}
                  row={c}
                  submitLabel="Save changes"
                  onSubmit={async (v) => {
                    if (await submit(() => partnerApi.capabilities.edit("certifications", c.id, { issuer: text(v.issuer), referenceNumber: text(v.reference), issuedAt: v.from || null, expiresAt: v.expires || null }), "Certification updated — awaiting review")) setEditing(null);
                  }}
                />
              ) : null
            }
          />
        );
      })}
    </Group>
  );
}

type TypeOptions = ReadonlyArray<{ code: string; label: string }>;
type DatedValues = { name: string; issuer: string; reference: string; from: string; expires: string };

/** Add (no `row`: asks for the name) or edit (`row`: the type is fixed, only its facts change). */
function CertificationForm({ busy, row, options, submitLabel, onSubmit }: { busy: boolean; row?: ProviderCertificationRow; options?: TypeOptions; submitLabel: string; onSubmit: (v: DatedValues) => Promise<void> }) {
  const [v, setV] = useState<DatedValues>({ name: "", issuer: row?.issuer ?? "", reference: row?.referenceNumber ?? "", from: toDateInput(row?.issuedAt), expires: toDateInput(row?.expiresAt) });
  const set = (patch: Partial<DatedValues>) => setV((cur) => ({ ...cur, ...patch }));
  const errorId = useId();
  const datesWrong = Boolean(v.from && v.expires && v.expires <= v.from);
  const nameOk = row ? true : Boolean(toCapabilityCode(v.name));
  return (
    <form className={formClass} onSubmit={(e: FormEvent) => { e.preventDefault(); if (nameOk && !datesWrong) void onSubmit(v); }}>
      {row ? null : <NameField label="Certificate name" value={v.name} onChange={(name) => set({ name })} placeholder="For example: Electrician licence" options={options} />}
      <Field label="Issued by (optional)">
        <input value={v.issuer} onChange={(e) => set({ issuer: e.target.value })} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Certificate number (optional)">
        <input value={v.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Issue date (optional)">
        <input type="date" value={v.from} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
      </Field>
      <Field label="Expiry date (optional)" hint="Leave empty if it does not expire.">
        <input type="date" value={v.expires} onChange={(e) => set({ expires: e.target.value })} aria-invalid={datesWrong} aria-describedby={datesWrong ? errorId : undefined} className={inputClass} />
      </Field>
      {datesWrong ? <p id={errorId} role="alert" className="text-xs font-semibold text-partner-danger sm:col-span-2">The expiry date must be after the issue date.</p> : null}
      <FormActions busy={busy} disabled={!nameOk || datesWrong} label={submitLabel} />
    </form>
  );
}

/* ------------------------------------------------------------------ equipment */

function EquipmentGroup({ data, busy, submit }: GroupProps) {
  return (
    <Group
      kind="equipment"
      title="Equipment"
      icon={Wrench}
      description="Tools and machines you can bring to a job. Tell us when one is out of service so you are not sent to jobs that need it."
      count={data.equipment.length}
      empty="No equipment declared yet."
      addLabel="Add equipment"
      form={(close) => (
        <EquipmentForm
          busy={busy}
          // One row per equipment type: a type already on the list is changed on its row, not re-added.
          options={requirementOptions(data.requirementCatalogue, "equipment", data.equipment.map((e) => e.equipmentType))}
          onSubmit={async (v) => {
            if (await submit(() => partnerApi.capabilities.declareEquipment({ equipmentType: toCapabilityCode(v.name), ownership: v.ownership, operational: v.operational, note: text(v.note) }), "Equipment added — awaiting review")) close();
          }}
        />
      )}
    >
      {data.equipment.map((e) => {
        const name = humanizeCode(e.equipmentType);
        const next: EquipmentOperational = e.operational === "OPERATIONAL" ? "OUT_OF_SERVICE" : "OPERATIONAL";
        return (
          <Row
            key={e.id}
            title={name}
            lines={[OWNERSHIP_LABEL[e.ownership] ?? e.ownership, e.note]}
            badges={
              <>
                <StatusBadge status={e.status} />
                <Badge icon={e.operational === "OPERATIONAL" ? ShieldCheck : XCircle} tone={e.operational === "OPERATIONAL" ? "ok" : "bad"}>
                  {OPERATIONAL_LABEL[e.operational] ?? e.operational}
                </Badge>
                <ExpiryBadge hint={expiryHint({ validity: e.validity, nearExpiry: e.nearExpiry, expiresAt: e.inspectionDueAt }, "Inspection due")} />
                <RequiredMark required={isRequiredByServices(data.requirementCatalogue, "equipment", e.equipmentType)} />
              </>
            }
            note={e.status === "VERIFIED" ? null : STATUS_META[e.status].explain}
            locked={isLocked("equipment", e)}
            actions={
              canToggleOperational(e) || canWithdraw("equipment", e) ? (
                <>
                  {canToggleOperational(e) ? (
                    <PartnerButton
                      variant="outline"
                      className="min-h-11"
                      disabled={busy}
                      aria-label={`${next === "OUT_OF_SERVICE" ? "Mark out of service" : "Mark working again"}: ${name}`}
                      // Ownership and note are re-sent unchanged: on a verified item only the working state may change.
                      onClick={() => void submit(() => partnerApi.capabilities.declareEquipment({ equipmentType: e.equipmentType, ownership: e.ownership, operational: next, note: e.note }), next === "OUT_OF_SERVICE" ? "Marked out of service" : "Marked working again")}
                    >
                      {next === "OUT_OF_SERVICE" ? "Mark out of service" : "Mark working again"}
                    </PartnerButton>
                  ) : null}
                  {canWithdraw("equipment", e) ? (
                    <RemoveButton label={name} busy={busy} onRemove={() => void submit(() => partnerApi.capabilities.withdraw("equipment", e.id), "Equipment removed")} />
                  ) : null}
                </>
              ) : null
            }
          />
        );
      })}
    </Group>
  );
}

type EquipmentValues = { name: string; ownership: EquipmentOwnership; operational: EquipmentOperational; note: string };

function EquipmentForm({ busy, options, onSubmit }: { busy: boolean; options?: TypeOptions; onSubmit: (v: EquipmentValues) => Promise<void> }) {
  const [v, setV] = useState<EquipmentValues>({ name: "", ownership: "OWNED", operational: "OPERATIONAL", note: "" });
  const set = (patch: Partial<EquipmentValues>) => setV((cur) => ({ ...cur, ...patch }));
  const nameOk = Boolean(toCapabilityCode(v.name));
  return (
    <form className={formClass} onSubmit={(e: FormEvent) => { e.preventDefault(); if (nameOk) void onSubmit(v); }}>
      <NameField label="Equipment name" value={v.name} onChange={(name) => set({ name })} placeholder="For example: Pressure washer" options={options} />
      <Field label="Ownership">
        <select value={v.ownership} onChange={(e) => set({ ownership: e.target.value as EquipmentOwnership })} className={inputClass}>
          {(Object.keys(OWNERSHIP_LABEL) as EquipmentOwnership[]).map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
        </select>
      </Field>
      <Field label="Condition">
        <select value={v.operational} onChange={(e) => set({ operational: e.target.value as EquipmentOperational })} className={inputClass}>
          {(Object.keys(OPERATIONAL_LABEL) as EquipmentOperational[]).map((o) => <option key={o} value={o}>{OPERATIONAL_LABEL[o]}</option>)}
        </select>
      </Field>
      <Field label="Note (optional)" hint="Model, capacity or anything our team should know.">
        <input value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} className={inputClass} />
      </Field>
      <FormActions busy={busy} disabled={!nameOk} label="Add equipment" />
    </form>
  );
}

/* ------------------------------------------------------------------ insurance */

function InsuranceGroup({ data, busy, submit }: GroupProps) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <Group
      kind="insurance"
      title="Insurance"
      icon={ShieldCheck}
      description="Cover you hold for your work. A policy only counts while it is verified and in date."
      count={data.insurance.length}
      empty="No insurance declared yet."
      addLabel="Add insurance"
      form={(close) => (
        <InsuranceForm
          busy={busy}
          options={requirementOptions(data.requirementCatalogue, "insurance")}
          submitLabel="Add insurance"
          onSubmit={async (v) => {
            if (await submit(() => partnerApi.capabilities.declareInsurance({ insuranceType: toCapabilityCode(v.name), insurer: text(v.issuer), policyReference: text(v.reference), effectiveFrom: v.from || null, expiresAt: v.expires }), "Insurance added — awaiting review")) close();
          }}
        />
      )}
    >
      {data.insurance.map((p) => {
        const name = humanizeCode(p.insuranceType);
        return (
          <Row
            key={p.id}
            title={name}
            lines={[p.insurer && `Insurer: ${p.insurer}`, p.policyReference && `Policy ${p.policyReference}`, p.effectiveFrom && `In effect from ${formatDay(p.effectiveFrom)}`]}
            badges={<><StatusBadge status={p.status} /><ExpiryBadge hint={expiryHint(p)} /><RequiredMark required={isRequiredByServices(data.requirementCatalogue, "insurance", p.insuranceType)} /></>}
            note={p.status === "REVOKED" && p.revokedReason ? `Revoked: ${p.revokedReason}` : p.status === "VERIFIED" ? null : STATUS_META[p.status].explain}
            locked={isLocked("insurance", p)}
            actions={
              canEdit("insurance", p) || canWithdraw("insurance", p) ? (
                <>
                  {canEdit("insurance", p) ? (
                    <PartnerButton variant="outline" className="min-h-11" disabled={busy} aria-expanded={editing === p.id} aria-label={`Edit ${name}`} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      {editing === p.id ? "Close" : "Edit"}
                    </PartnerButton>
                  ) : null}
                  {canWithdraw("insurance", p) ? (
                    <RemoveButton label={name} busy={busy} onRemove={() => void submit(() => partnerApi.capabilities.withdraw("insurance", p.id), "Insurance removed")} />
                  ) : null}
                </>
              ) : null
            }
            editor={
              editing === p.id ? (
                <InsuranceForm
                  busy={busy}
                  row={p}
                  submitLabel="Save changes"
                  onSubmit={async (v) => {
                    if (await submit(() => partnerApi.capabilities.edit("insurance", p.id, { insurer: text(v.issuer), policyReference: text(v.reference), effectiveFrom: v.from || null, expiresAt: v.expires }), "Insurance updated — awaiting review")) setEditing(null);
                  }}
                />
              ) : null
            }
          />
        );
      })}
    </Group>
  );
}

function InsuranceForm({ busy, row, options, submitLabel, onSubmit }: { busy: boolean; row?: ProviderInsuranceRow; options?: TypeOptions; submitLabel: string; onSubmit: (v: DatedValues) => Promise<void> }) {
  const [v, setV] = useState<DatedValues>({ name: "", issuer: row?.insurer ?? "", reference: row?.policyReference ?? "", from: toDateInput(row?.effectiveFrom), expires: toDateInput(row?.expiresAt) });
  const set = (patch: Partial<DatedValues>) => setV((cur) => ({ ...cur, ...patch }));
  const errorId = useId();
  const datesWrong = Boolean(v.from && v.expires && v.expires <= v.from);
  const nameOk = row ? true : Boolean(toCapabilityCode(v.name));
  const ready = nameOk && Boolean(v.expires) && !datesWrong;
  return (
    <form className={formClass} onSubmit={(e: FormEvent) => { e.preventDefault(); if (ready) void onSubmit(v); }}>
      {row ? null : <NameField label="Type of cover" value={v.name} onChange={(name) => set({ name })} placeholder="For example: Public liability" options={options} />}
      <Field label="Insurer (optional)">
        <input value={v.issuer} onChange={(e) => set({ issuer: e.target.value })} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Policy number (optional)">
        <input value={v.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Start date (optional)">
        <input type="date" value={v.from} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
      </Field>
      <Field label="Expiry date (required)">
        <input type="date" value={v.expires} required onChange={(e) => set({ expires: e.target.value })} aria-invalid={datesWrong} aria-describedby={datesWrong ? errorId : undefined} className={inputClass} />
      </Field>
      {datesWrong ? <p id={errorId} role="alert" className="text-xs font-semibold text-partner-danger sm:col-span-2">The expiry date must be after the start date.</p> : null}
      <FormActions busy={busy} disabled={!ready} label={submitLabel} />
    </form>
  );
}

/* ------------------------------------------------------------------ languages */

function LanguagesGroup({ data, busy, submit }: GroupProps) {
  const held = new Set(data.languages.map((l) => l.languageCode));
  const available = LANGUAGE_OPTIONS.filter((l) => !held.has(l.code));
  return (
    <Group
      kind="languages"
      title="Languages"
      icon={Languages}
      description="Languages you can work in. These are used as you declare them — they are not reviewed."
      count={data.languages.length}
      empty="No languages declared yet."
      addLabel="Add language"
      form={(close) => (
        <LanguageForm
          busy={busy}
          options={available}
          onSubmit={async (languageCode, proficiency) => {
            if (await submit(() => partnerApi.capabilities.declareLanguage({ languageCode, proficiency }), "Language added")) close();
          }}
        />
      )}
    >
      {data.languages.map((l) => {
        const name = languageName(l.languageCode);
        return (
          <Row
            key={l.id}
            title={name}
            lines={[`Proficiency: ${PROFICIENCY_LABEL[l.proficiency] ?? l.proficiency}`, l.source === "ADMIN" && "Recorded by our team."]}
            badges={<Badge icon={l.active ? BadgeCheck : Ban} tone={l.active ? "ok" : "bad"}>{l.active ? "Active" : "Inactive"}</Badge>}
            locked={isLocked("languages", l)}
            actions={
              canEdit("languages", l) ? (
                <>
                  <ProficiencyEditor
                    label={`Proficiency in ${name}`}
                    value={l.proficiency}
                    busy={busy}
                    onSave={(proficiency) => void submit(() => partnerApi.capabilities.declareLanguage({ languageCode: l.languageCode, proficiency }), "Language updated")}
                  />
                  {canWithdraw("languages", l) ? (
                    <RemoveButton label={name} busy={busy} onRemove={() => void submit(() => partnerApi.capabilities.withdraw("languages", l.id), "Language removed")} />
                  ) : null}
                </>
              ) : null
            }
          />
        );
      })}
    </Group>
  );
}

function ProficiencySelect({ value, onChange, label }: { value: LanguageProficiency; onChange: (p: LanguageProficiency) => void; label?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as LanguageProficiency)} className={cn(inputClass, label ? "w-auto min-w-40" : undefined)}>
      {LANGUAGE_PROFICIENCIES.map((p) => <option key={p} value={p}>{PROFICIENCY_LABEL[p]}</option>)}
    </select>
  );
}

function LanguageForm({ busy, options, onSubmit }: { busy: boolean; options: ReadonlyArray<{ code: string; name: string }>; onSubmit: (code: string, proficiency: LanguageProficiency) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [proficiency, setProficiency] = useState<LanguageProficiency>("CONVERSATIONAL");
  if (options.length === 0) return <p className="text-sm text-partner-muted">Every language in the list is already on your profile.</p>;
  return (
    <form className={formClass} onSubmit={(e: FormEvent) => { e.preventDefault(); if (code) void onSubmit(code, proficiency); }}>
      <Field label="Language">
        <select value={code} onChange={(e) => setCode(e.target.value)} required className={inputClass}>
          <option value="">Choose a language…</option>
          {options.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="How well you speak it">
        <ProficiencySelect value={proficiency} onChange={setProficiency} />
      </Field>
      <div className="sm:col-span-2">
        <PartnerButton type="submit" className="min-h-11" disabled={busy || !code}>{busy ? "Saving…" : "Add language"}</PartnerButton>
      </div>
    </form>
  );
}

function ProficiencyEditor({ label, value, busy, onSave }: { label: string; value: LanguageProficiency; busy: boolean; onSave: (p: LanguageProficiency) => void }) {
  const [proficiency, setProficiency] = useState<LanguageProficiency>(value);
  return (
    <span className="inline-flex flex-wrap items-end gap-2">
      <span className="text-xs text-partner-muted">
        Proficiency
        <span className="block"><ProficiencySelect label={label} value={proficiency} onChange={setProficiency} /></span>
      </span>
      <PartnerButton variant="outline" className="min-h-11" disabled={busy || proficiency === value} onClick={() => onSave(proficiency)}>Update</PartnerButton>
    </span>
  );
}
