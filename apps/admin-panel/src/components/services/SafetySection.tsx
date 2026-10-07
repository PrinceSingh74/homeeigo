"use client";

import type { ServiceCatalogConfig } from "@/services/admin-api";
import { Field, LinesField, NotApplicableReasonField, Section, clean, lines, listIssue, listOrUndefined, num, str, textOrUndefined, wholeNumberIssue, type ConfigIssue } from "./config-form";

/**
 * Phase 10 §9 — structured safety content (`catalogConfig.safety`) and the customer age policy
 * (`catalogConfig.customerPolicy.age`). Both are frozen into a booking when it is made.
 *
 * Who reads what follows the backend projections (lib/service-safety.ts): the customer sees the
 * information, warnings, their own requirements, chemical restrictions, the disclaimer and the
 * emergency line; everything else is for the professional.
 */

export type SafetyForm = {
  information: string;
  warnings: string;
  prohibitedConditions: string;
  customerRequirements: string;
  providerRequirements: string;
  medicalDisclaimer: string;
  emergencyProtocol: string;
  ppe: string;
  chemicalRestrictions: string;
  incidentProtocol: string;
};

/** Limits mirrored from the backend schema: [max items, max characters per item] for lists, max characters for text. */
const LISTS = {
  warnings: [20, 300],
  prohibitedConditions: [20, 300],
  customerRequirements: [15, 300],
  providerRequirements: [15, 300],
  ppe: [15, 80],
  chemicalRestrictions: [15, 300],
} as const;
const TEXTS = { information: 2000, medicalDisclaimer: 1000, emergencyProtocol: 1000, incidentProtocol: 1000 } as const;

export function safetyFromConfig(c: ServiceCatalogConfig): SafetyForm {
  const s = c.safety;
  return {
    information: s?.information ?? "",
    warnings: lines(s?.warnings),
    prohibitedConditions: lines(s?.prohibitedConditions),
    customerRequirements: lines(s?.customerRequirements),
    providerRequirements: lines(s?.providerRequirements),
    medicalDisclaimer: s?.medicalDisclaimer ?? "",
    emergencyProtocol: s?.emergencyProtocol ?? "",
    ppe: lines(s?.ppe),
    chemicalRestrictions: lines(s?.chemicalRestrictions),
    incidentProtocol: s?.incidentProtocol ?? "",
  };
}

export function safetyToConfig(f: SafetyForm, base?: ServiceCatalogConfig["safety"]): ServiceCatalogConfig["safety"] {
  return clean({
    ...(base ?? {}),
    information: textOrUndefined(f.information),
    warnings: listOrUndefined(f.warnings),
    prohibitedConditions: listOrUndefined(f.prohibitedConditions),
    customerRequirements: listOrUndefined(f.customerRequirements),
    providerRequirements: listOrUndefined(f.providerRequirements),
    medicalDisclaimer: textOrUndefined(f.medicalDisclaimer),
    emergencyProtocol: textOrUndefined(f.emergencyProtocol),
    ppe: listOrUndefined(f.ppe),
    chemicalRestrictions: listOrUndefined(f.chemicalRestrictions),
    incidentProtocol: textOrUndefined(f.incidentProtocol),
  });
}

const textIssue = (value: string, max: number) => (value.trim().length > max ? `At most ${max} characters.` : undefined);

export function safetyIssues(f: SafetyForm): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const add = (message?: string) => message && out.push({ tab: "safety", section: "Safety", message });
  for (const [k, [items, len]] of Object.entries(LISTS) as [keyof typeof LISTS, readonly [number, number]][]) add(listIssue(f[k], items, len));
  for (const [k, max] of Object.entries(TEXTS) as [keyof typeof TEXTS, number][]) add(textIssue(f[k], max));
  return out;
}

/**
 * `notApplicableReason` is `catalogConfig.notApplicableReasons.safety` — it lives beside the safety
 * block, not in it, so the parent owns the value and this section only shows the field.
 */
export function SafetySection({
  value: f,
  onChange,
  notApplicableReason,
  onNotApplicableReason,
}: {
  value: SafetyForm;
  onChange: (next: SafetyForm) => void;
  notApplicableReason: string;
  onNotApplicableReason: (next: string) => void;
}) {
  const set = <K extends keyof SafetyForm>(k: K, v: string) => onChange({ ...f, [k]: v });
  const listField = (k: keyof typeof LISTS, label: string, consumer: string, placeholder?: string) => (
    <LinesField label={label} consumer={consumer} value={f[k]} onChange={(v) => set(k, v)} maxItems={LISTS[k][0]} maxLen={LISTS[k][1]} placeholder={placeholder} />
  );
  const textField = (k: keyof typeof TEXTS, label: string, consumer: string, rows = 3) => (
    <Field label={label} consumer={consumer} error={textIssue(f[k], TEXTS[k])}>
      <textarea className="sv-input sv-textarea" rows={rows} value={f[k]} onChange={(x) => set(k, x.target.value)} />
    </Field>
  );
  return (
    <>
      <Section title="Safety for the customer" hint="Shown to the customer before booking and on the visit screen, exactly as written. Leave a field empty and nothing is shown for it." open>
        {textField("information", "Safety information", "Customer")}
        {listField("warnings", "Warnings", "Customer + professional", "Keep children and pets out of the work area")}
        {listField("customerRequirements", "What the customer must do", "Customer", "Clear the area before the professional arrives")}
        {listField("chemicalRestrictions", "Chemical restrictions", "Customer + professional", "No bleach on natural stone")}
        {textField("medicalDisclaimer", "Medical disclaimer", "Customer", 2)}
        {textField("emergencyProtocol", "Emergency protocol", "Customer + professional", 2)}
      </Section>
      <Section title="Safety for the professional" hint="Shown to the assigned professional in the job brief. Protective equipment listed here applies to the whole job; a work-plan step can add its own." open>
        {listField("providerRequirements", "What the professional must do", "Professional")}
        {listField("ppe", "Protective equipment", "Professional", "Gloves")}
        {listField("prohibitedConditions", "Do not proceed if", "Professional", "Exposed live wiring")}
        {textField("incidentProtocol", "Incident protocol", "Professional")}
      </Section>
      <Section title="If safety does not apply" hint="To publish, a service needs at least one “Do not proceed if” condition and an incident protocol. If this service really has no safety content, say why here instead." open>
        <NotApplicableReasonField section="safety" value={notApplicableReason} onChange={onNotApplicableReason} />
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

export type AgePolicyForm = { mode: string; minimumAge: string; adultAge: string; guardianMinimumAge: string };

const AGE_MODES = [
  ["NONE", "No age rule"],
  ["MINIMUM_AGE", "Minimum age"],
  ["ADULT_ONLY", "Adults only"],
  ["GUARDIAN_REQUIRED", "Guardian required below an age"],
] as const;
/** The number each mode needs. No legal age is assumed anywhere — the admin states it. */
const AGE_NUMBER: Record<string, { key: "minimumAge" | "adultAge" | "guardianMinimumAge"; label: string; help: string } | undefined> = {
  MINIMUM_AGE: { key: "minimumAge", label: "Minimum age (years)", help: "Customers younger than this cannot book." },
  ADULT_ONLY: { key: "adultAge", label: "Adult age (years)", help: "The age from which a customer counts as an adult for this service." },
  GUARDIAN_REQUIRED: { key: "guardianMinimumAge", label: "Guardian needed below (years)", help: "Customers younger than this need a guardian present." },
};

export function agePolicyFromConfig(c: ServiceCatalogConfig): AgePolicyForm {
  const a = c.customerPolicy?.age;
  return { mode: a?.mode ?? "", minimumAge: str(a?.minimumAge), adultAge: str(a?.adultAge), guardianMinimumAge: str(a?.guardianMinimumAge) };
}

/**
 * "Not set" removes the age block and keeps the rest of the policy. Numbers of the other modes are
 * carried as stored (the backend reads only the one the mode names), so an untouched save changes nothing.
 */
export function agePolicyToConfig(f: AgePolicyForm, base?: ServiceCatalogConfig["customerPolicy"]): ServiceCatalogConfig["customerPolicy"] {
  const age = f.mode
    ? (clean({ mode: f.mode, minimumAge: num(f.minimumAge), adultAge: num(f.adultAge), guardianMinimumAge: num(f.guardianMinimumAge) }) as NonNullable<ServiceCatalogConfig["customerPolicy"]>["age"])
    : undefined;
  return clean({ ...(base ?? {}), age });
}

export function agePolicyIssue(f: AgePolicyForm): string | undefined {
  const need = AGE_NUMBER[f.mode];
  if (!need) return undefined;
  if (f[need.key].trim() === "") return `${need.label} is required for this rule — no legal age is assumed.`;
  return wholeNumberIssue(f[need.key], 1, 120);
}

export function agePolicyIssues(f: AgePolicyForm): ConfigIssue[] {
  const message = agePolicyIssue(f);
  return message ? [{ tab: "audience", section: "Age policy", message }] : [];
}

export function AgePolicySection({ value: f, onChange }: { value: AgePolicyForm; onChange: (next: AgePolicyForm) => void }) {
  const need = AGE_NUMBER[f.mode];
  return (
    <Section title="Age policy" hint="Checked by the server when a booking is made. The age itself is always stated here — the platform assumes no legal age.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rule" consumer="Booking check">
          <select className="sv-input" value={f.mode} onChange={(x) => onChange({ ...f, mode: x.target.value })}>
            <option value="">Not set (no age rule)</option>
            {AGE_MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {need ? (
          <Field label={need.label} consumer="Booking check" error={agePolicyIssue(f)} help={need.help}>
            <input className="sv-input" type="number" min={1} max={120} value={f[need.key]} onChange={(x) => onChange({ ...f, [need.key]: x.target.value })} />
          </Field>
        ) : null}
      </div>
    </Section>
  );
}
