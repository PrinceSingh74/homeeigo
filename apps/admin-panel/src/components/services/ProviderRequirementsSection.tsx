"use client";

import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ServiceCatalogConfig } from "@/services/admin-api";
import { CODE_RE, EmptyRow, Field, Section, Toggle, clean, num, str, unlessDefault, wholeNumberIssue, type ConfigIssue } from "./config-form";

/**
 * Phase 11 — what a professional must hold to be offered this service
 * (`catalogConfig.providerRequirements`, backend lib/provider-capability.ts). Every entry is a HARD
 * matching gate, evaluated before ranking; none of them is a score.
 *
 * The legacy comma list `requiredSkills` stays on the Fulfilment tab and is merged separately.
 */

type PR = NonNullable<ServiceCatalogConfig["providerRequirements"]>;

const SKILL_LEVELS = ["BASIC", "SKILLED", "EXPERT"] as const;
const EQUIPMENT_REQUIREMENTS = [
  ["REQUIRED", "Professional must own it"],
  ["OPTIONAL", "Optional"],
  ["NOT_REQUIRED", "Not required"],
  ["CUSTOMER_PROVIDED", "Customer provides it"],
] as const;
const PROFICIENCIES = ["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"] as const;
/** Backend list limits. */
const MAX = { skills: 20, certifications: 15, equipment: 30, insurance: 10, languages: 10, trainingModules: 20 } as const;

export type SkillRow = { code: string; minLevel: string; verifiedOnly: boolean };
export type CertificationRow = { type: string; verificationRequired: boolean };
export type EquipmentRow = { type: string; requirement: string };
export type InsuranceRow = { type: string };
export type LanguageRow = { code: string; minProficiency: string };

export type ProviderRequirementsForm = {
  kycRequired: boolean;
  backgroundCheckRequired: boolean;
  experienceYears: string;
  trainingModules: string[];
  skills: SkillRow[];
  certifications: CertificationRow[];
  equipment: EquipmentRow[];
  insurance: InsuranceRow[];
  languages: LanguageRow[];
};

/** The academy modules offered as training gates (published only; the caller filters). */
export type TrainingModuleOption = { slug: string; title: string };

export function providerRequirementsFromConfig(c: ServiceCatalogConfig): ProviderRequirementsForm {
  const p = c.providerRequirements;
  return {
    kycRequired: p?.kycRequired === true,
    backgroundCheckRequired: p?.backgroundCheckRequired === true,
    experienceYears: str(p?.experienceYears),
    trainingModules: p?.trainingModules ?? [],
    skills: (p?.skills ?? []).map((s) => ({ code: s.code, minLevel: s.minLevel ?? "", verifiedOnly: s.verifiedOnly === true })),
    certifications: (p?.requiredCertifications ?? []).map((x) => ({ type: x.type, verificationRequired: x.verificationRequired === true })),
    equipment: (p?.requiredEquipment ?? []).map((x) => ({ type: x.type, requirement: x.requirement })),
    insurance: (p?.requiredInsurance ?? []).map((x) => ({ type: x.type })),
    languages: (p?.languages ?? []).map((l) => ({ code: l.code, minProficiency: l.minProficiency ?? "" })),
  };
}

const code = (s: string) => s.trim().toLowerCase();

/**
 * Form → the keys this section owns, to be merged onto the stored `providerRequirements`. A row with
 * a blank code is dropped (an unfinished row is not a requirement); `undefined` removes the key.
 */
export function providerRequirementsToConfig(f: ProviderRequirementsForm, base?: PR): Partial<PR> {
  const prevSkill = new Map((base?.skills ?? []).map((s) => [s.code, s]));
  const prevCert = new Map((base?.requiredCertifications ?? []).map((x) => [x.type, x]));
  const skills = f.skills
    .filter((s) => code(s.code))
    .map((s) => clean({ code: code(s.code), minLevel: (s.minLevel || undefined) as NonNullable<PR["skills"]>[number]["minLevel"], verifiedOnly: unlessDefault(prevSkill.get(code(s.code)), "verifiedOnly", s.verifiedOnly, false) })!);
  const certifications = f.certifications
    .filter((x) => code(x.type))
    .map((x) => clean({ type: code(x.type), verificationRequired: unlessDefault(prevCert.get(code(x.type)), "verificationRequired", x.verificationRequired, false) })!);
  const equipment = f.equipment.filter((x) => code(x.type)).map((x) => ({ type: code(x.type), requirement: x.requirement as NonNullable<PR["requiredEquipment"]>[number]["requirement"] }));
  const insurance = f.insurance.filter((x) => code(x.type)).map((x) => ({ type: code(x.type) }));
  const languages = f.languages
    .filter((l) => code(l.code))
    .map((l) => clean({ code: code(l.code), minProficiency: (l.minProficiency || undefined) as NonNullable<PR["languages"]>[number]["minProficiency"] })!);
  return {
    kycRequired: unlessDefault(base, "kycRequired", f.kycRequired, false),
    backgroundCheckRequired: unlessDefault(base, "backgroundCheckRequired", f.backgroundCheckRequired, false),
    experienceYears: num(f.experienceYears),
    trainingModules: f.trainingModules.length ? f.trainingModules : undefined,
    skills: skills.length ? skills : undefined,
    requiredCertifications: certifications.length ? certifications : undefined,
    requiredEquipment: equipment.length ? equipment : undefined,
    requiredInsurance: insurance.length ? insurance : undefined,
    languages: languages.length ? languages : undefined,
  };
}

/** A typed capability code: lowercase words joined by single hyphens, at most 40 characters. */
const codeIssue = (value: string, all: string[], index: number): string | undefined => {
  const c = code(value);
  if (!c) return undefined;
  if (c.length > 40 || !CODE_RE.test(c)) return "Lowercase letters and digits, words joined by single hyphens (max 40).";
  return all.findIndex((x) => code(x) === c) !== index ? "Listed twice." : undefined;
};
const languageIssue = (value: string, all: string[], index: number): string | undefined => {
  const c = code(value);
  if (!c) return undefined;
  if (!/^[a-z]{2}$/.test(c)) return "Two-letter language code, e.g. en, hi.";
  return all.findIndex((x) => code(x) === c) !== index ? "Listed twice." : undefined;
};
/** An academy slug can gate matching only if it is a valid capability code (the backend refuses any other, max 80). */
export const usableTrainingSlug = (slug: string) => slug.length <= 80 && CODE_RE.test(slug);

export function providerRequirementsIssues(f: ProviderRequirementsForm): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const add = (what: string, message?: string) => message && out.push({ tab: "professionals", section: "Professional requirements", message: `${what}: ${message}` });
  add("Experience", wholeNumberIssue(f.experienceYears, 0, 50));
  const each = (what: string, values: string[], max: number, check: typeof codeIssue) => {
    if (values.filter((v) => code(v)).length > max) add(what, `At most ${max}.`);
    values.forEach((v, i) => add(`${what} ${i + 1}`, check(v, values, i)));
  };
  each("Skill", f.skills.map((s) => s.code), MAX.skills, codeIssue);
  each("Certification", f.certifications.map((s) => s.type), MAX.certifications, codeIssue);
  each("Equipment", f.equipment.map((s) => s.type), MAX.equipment, codeIssue);
  each("Insurance", f.insurance.map((s) => s.type), MAX.insurance, codeIssue);
  each("Language", f.languages.map((s) => s.code), MAX.languages, languageIssue);
  if (f.trainingModules.length > MAX.trainingModules) add("Training", `At most ${MAX.trainingModules} modules.`);
  // The schema now refuses a slug the gate could not read, so this blocks the save rather than being silently ignored.
  const badModule = f.trainingModules.find((m) => !usableTrainingSlug(m));
  if (badModule) add("Training", `"${badModule}" is not a valid module slug — untick it.`);
  return out;
}

/** A repeatable list of small rows: the same add / remove affordance for every typed requirement. */
function RowList<T>({
  title,
  consumer,
  empty,
  addLabel,
  rows,
  max,
  blank,
  onChange,
  render,
}: {
  title: string;
  consumer: string;
  empty: string;
  addLabel: string;
  rows: T[];
  max: number;
  blank: T;
  onChange: (rows: T[]) => void;
  render: (row: T, index: number, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        {title}
        <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[var(--color-biz-muted)]">{consumer}</span>
      </p>
      {rows.length === 0 ? <EmptyRow>{empty}</EmptyRow> : null}
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2 rounded-lg border border-[var(--color-biz-line)] p-2">
          <div className="grid min-w-0 flex-1 grid-cols-2 items-start gap-2">{render(row, i, (patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))))}</div>
          <button type="button" className="biz-btn text-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${title.toLowerCase()} row ${i + 1}`}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button type="button" className="biz-btn self-start text-xs" disabled={rows.length >= max} onClick={() => onChange([...rows, blank])}>
        <Plus className="h-3 w-3" /> {addLabel}
      </button>
    </div>
  );
}

export function ProviderRequirementsSection({
  value: f,
  onChange,
  trainingModules,
  trainingModulesState = "ready",
}: {
  value: ProviderRequirementsForm;
  onChange: (next: ProviderRequirementsForm) => void;
  /** Published academy modules. */
  trainingModules: TrainingModuleOption[];
  trainingModulesState?: "loading" | "error" | "ready";
}) {
  const set = <K extends keyof ProviderRequirementsForm>(k: K, v: ProviderRequirementsForm[K]) => onChange({ ...f, [k]: v });
  const known = new Set(trainingModules.map((m) => m.slug));
  // A module saved earlier that is no longer published (or was never in the academy) stays visible so it can be removed.
  const orphans = f.trainingModules.filter((m) => !known.has(m));
  const toggleModule = (slug: string) => set("trainingModules", f.trainingModules.includes(slug) ? f.trainingModules.filter((m) => m !== slug) : [...f.trainingModules, slug]);
  const skillCodes = f.skills.map((s) => s.code);
  const certTypes = f.certifications.map((s) => s.type);
  const equipmentTypes = f.equipment.map((s) => s.type);
  const insuranceTypes = f.insurance.map((s) => s.type);
  const languageCodes = f.languages.map((s) => s.code);

  return (
    <>
      <Section
        title="Professional requirements"
        hint="These are hard matching gates — a professional who does not meet them is never offered the job. Add only what the service truly needs: every gate shrinks the pool."
        open
      >
        <div className="flex flex-wrap gap-3">
          <Toggle label="Verified identity (KYC) required" consumer="Matching gate" checked={f.kycRequired} onChange={(v) => set("kycRequired", v)} />
          <Toggle label="Cleared background check required" consumer="Matching gate" checked={f.backgroundCheckRequired} onChange={(v) => set("backgroundCheckRequired", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum experience (years)" consumer="Matching gate" error={wholeNumberIssue(f.experienceYears, 0, 50)} help="Empty or 0 = no experience gate.">
            <input className="sv-input" type="number" min={0} max={50} value={f.experienceYears} onChange={(x) => set("experienceYears", x.target.value)} />
          </Field>
        </div>
        <fieldset className="sv-field">
          <legend className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--color-biz-muted)]">
            Required training
            <span className="ml-2 text-[10px] font-normal tracking-wide">Matching gate · published academy modules</span>
          </legend>
          {trainingModulesState === "loading" ? (
            <p className="text-xs text-[var(--color-biz-muted)]" role="status">Loading academy modules…</p>
          ) : trainingModulesState === "error" ? (
            <p className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">Academy modules could not be loaded. Modules already required are kept; reload to change them.</p>
          ) : trainingModules.length === 0 && orphans.length === 0 ? (
            <EmptyRow>No published academy modules yet — publish a module in Academy to require it here.</EmptyRow>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {trainingModules.map((m) => {
              const usable = usableTrainingSlug(m.slug);
              return <Toggle key={m.slug} label={usable ? m.title : `${m.title} — slug “${m.slug}” cannot be used as a gate`} checked={f.trainingModules.includes(m.slug)} disabled={!usable && !f.trainingModules.includes(m.slug)} onChange={() => toggleModule(m.slug)} />;
            })}
            {orphans.map((slug) => (
              <Toggle key={slug} label={`${slug} — ${trainingModulesState === "ready" ? "not a published module" : "saved"}`} checked onChange={() => toggleModule(slug)} />
            ))}
          </div>
          {trainingModulesState === "ready" && orphans.length > 0 ? (
            <small className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
              A required module that is not published cannot be taken, so a professional who has not already completed it will never match. Untick it or publish the module.
            </small>
          ) : null}
        </fieldset>
      </Section>

      <Section title="Typed capabilities" hint="Codes must match the codes granted on a professional’s profile (lowercase, hyphens — e.g. ac-gas-refill). A code nobody holds matches nobody.">
        <RowList<SkillRow>
          title="Skills"
          consumer="Matching gate"
          empty="No typed skills required."
          addLabel="Add skill"
          rows={f.skills}
          max={MAX.skills}
          blank={{ code: "", minLevel: "", verifiedOnly: false }}
          onChange={(rows) => set("skills", rows)}
          render={(row, i, upd) => (
            <>
              <Field label="Skill code" error={codeIssue(row.code, skillCodes, i)}>
                <input className="sv-input" value={row.code} maxLength={40} onChange={(x) => upd({ code: x.target.value })} placeholder="deep-cleaning" />
              </Field>
              <Field label="Minimum level">
                <select className="sv-input" value={row.minLevel} onChange={(x) => upd({ minLevel: x.target.value })}>
                  <option value="">Any level</option>
                  {SKILL_LEVELS.map((v) => (
                    <option key={v} value={v}>
                      {v.charAt(0) + v.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Toggle label="Only a verified skill counts" checked={row.verifiedOnly} onChange={(v) => upd({ verifiedOnly: v })} />
            </>
          )}
        />
        <RowList<CertificationRow>
          title="Certifications"
          consumer="Matching gate"
          empty="No certifications required."
          addLabel="Add certification"
          rows={f.certifications}
          max={MAX.certifications}
          blank={{ type: "", verificationRequired: false }}
          onChange={(rows) => set("certifications", rows)}
          render={(row, i, upd) => (
            <>
              <Field label="Certification type" error={codeIssue(row.type, certTypes, i)}>
                <input className="sv-input" value={row.type} maxLength={40} onChange={(x) => upd({ type: x.target.value })} placeholder="electrical-licence" />
              </Field>
              <Toggle label="Must be verified by the platform" checked={row.verificationRequired} onChange={(v) => upd({ verificationRequired: v })} />
            </>
          )}
        />
        <RowList<EquipmentRow>
          title="Equipment"
          consumer="Matching gate"
          empty="No equipment required of the professional."
          addLabel="Add equipment"
          rows={f.equipment}
          max={MAX.equipment}
          blank={{ type: "", requirement: "REQUIRED" }}
          onChange={(rows) => set("equipment", rows)}
          render={(row, i, upd) => (
            <>
              <Field label="Equipment type" error={codeIssue(row.type, equipmentTypes, i)}>
                <input className="sv-input" value={row.type} maxLength={40} onChange={(x) => upd({ type: x.target.value })} placeholder="steam-cleaner" />
              </Field>
              <Field label="Requirement">
                <select className="sv-input" value={row.requirement} onChange={(x) => upd({ requirement: x.target.value })}>
                  {EQUIPMENT_REQUIREMENTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        />
        <RowList<InsuranceRow>
          title="Insurance"
          consumer="Matching gate"
          empty="No insurance required."
          addLabel="Add insurance"
          rows={f.insurance}
          max={MAX.insurance}
          blank={{ type: "" }}
          onChange={(rows) => set("insurance", rows)}
          render={(row, i, upd) => (
            <Field label="Insurance type" error={codeIssue(row.type, insuranceTypes, i)}>
              <input className="sv-input" value={row.type} maxLength={40} onChange={(x) => upd({ type: x.target.value })} placeholder="public-liability" />
            </Field>
          )}
        />
        <RowList<LanguageRow>
          title="Languages"
          consumer="Matching gate"
          empty="No language required."
          addLabel="Add language"
          rows={f.languages}
          max={MAX.languages}
          blank={{ code: "", minProficiency: "" }}
          onChange={(rows) => set("languages", rows)}
          render={(row, i, upd) => (
            <>
              <Field label="Language code" error={languageIssue(row.code, languageCodes, i)}>
                <input className="sv-input" value={row.code} maxLength={2} onChange={(x) => upd({ code: x.target.value })} placeholder="hi" />
              </Field>
              <Field label="Minimum proficiency">
                <select className="sv-input" value={row.minProficiency} onChange={(x) => upd({ minProficiency: x.target.value })}>
                  <option value="">Any</option>
                  {PROFICIENCIES.map((v) => (
                    <option key={v} value={v}>
                      {v.charAt(0) + v.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        />
      </Section>
    </>
  );
}
