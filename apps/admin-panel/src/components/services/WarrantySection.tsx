"use client";

import type { ServiceCatalogConfig, WarrantyIssueType } from "@/services/admin-api";
import { Field, LinesField, Section, Toggle, clean, lines, listIssue, listOrUndefined, num, str, textOrUndefined, unlessDefault, wholeNumberIssue, type ConfigIssue } from "./config-form";

/**
 * Phase 10 §11 — the warranty policy (`catalogConfig.warranty`) and the rework policy
 * (`catalogConfig.rework`). Frozen into each booking as `warranty.v1`: an edit never changes what a
 * customer was promised on a booking already made.
 *
 * Backend defaults when a field is unset (lib/service-warranty.ts): starts at COMPLETION, covers
 * QUALITY and INCOMPLETE, rework is offered first, a refund is allowed, no proof is needed.
 */

const ISSUE_TYPES: [WarrantyIssueType, string][] = [
  ["QUALITY", "Poor quality"],
  ["INCOMPLETE", "Incomplete work"],
  ["DAMAGE", "Damage"],
  ["BEHAVIOUR", "Behaviour"],
  ["NO_SHOW", "No-show"],
  ["BILLING", "Billing"],
  ["OTHER", "Other"],
];

export type WarrantyForm = {
  enabled: boolean;
  durationDays: string;
  startEvent: string;
  eligibleIssueTypes: string[];
  exclusions: string;
  proofRequired: boolean;
  reworkFirst: boolean;
  refundAllowed: boolean;
  damagePolicy: string;
  guarantee: string;
};
export type ReworkForm = { fee: string; sameProviderPreferred: boolean; windowDays: string };

export function warrantyFromConfig(c: ServiceCatalogConfig): WarrantyForm {
  const w = c.warranty;
  return {
    enabled: w?.enabled === true,
    durationDays: str(w?.durationDays),
    startEvent: w?.startEvent ?? "",
    eligibleIssueTypes: w?.eligibleIssueTypes ?? [],
    exclusions: lines(w?.exclusions),
    proofRequired: w?.proofRequired === true,
    reworkFirst: w?.reworkFirst !== false,
    refundAllowed: w?.refundAllowed !== false,
    damagePolicy: w?.damagePolicy ?? "",
    guarantee: w?.guarantee ?? "",
  };
}

export function warrantyToConfig(f: WarrantyForm, base?: ServiceCatalogConfig["warranty"]): ServiceCatalogConfig["warranty"] {
  const types = f.eligibleIssueTypes as WarrantyIssueType[];
  return clean({
    ...(base ?? {}),
    enabled: unlessDefault(base, "enabled", f.enabled, false),
    durationDays: num(f.durationDays),
    startEvent: (f.startEvent || undefined) as NonNullable<ServiceCatalogConfig["warranty"]>["startEvent"],
    eligibleIssueTypes: types.length ? types : undefined,
    exclusions: listOrUndefined(f.exclusions),
    proofRequired: unlessDefault(base, "proofRequired", f.proofRequired, false),
    reworkFirst: unlessDefault(base, "reworkFirst", f.reworkFirst, true),
    refundAllowed: unlessDefault(base, "refundAllowed", f.refundAllowed, true),
    damagePolicy: textOrUndefined(f.damagePolicy),
    guarantee: textOrUndefined(f.guarantee),
  });
}

export function reworkFromConfig(c: ServiceCatalogConfig): ReworkForm {
  const r = c.rework;
  return { fee: r?.fee ?? "", sameProviderPreferred: r?.sameProviderPreferred === true, windowDays: str(r?.windowDays) };
}

export function reworkToConfig(f: ReworkForm, base?: ServiceCatalogConfig["rework"]): ServiceCatalogConfig["rework"] {
  return clean({
    ...(base ?? {}),
    fee: (f.fee || undefined) as NonNullable<ServiceCatalogConfig["rework"]>["fee"],
    sameProviderPreferred: unlessDefault(base, "sameProviderPreferred", f.sameProviderPreferred, false),
    windowDays: num(f.windowDays),
  });
}

const durationIssue = (f: WarrantyForm) =>
  f.enabled && !((num(f.durationDays) ?? 0) > 0) ? "An enabled warranty needs a duration of at least 1 day." : wholeNumberIssue(f.durationDays, 0, 3650);
const textIssue = (value: string, max: number) => (value.trim().length > max ? `At most ${max} characters.` : undefined);

export function warrantyIssues(w: WarrantyForm, r: ReworkForm): ConfigIssue[] {
  return [durationIssue(w), listIssue(w.exclusions, 20, 300), textIssue(w.damagePolicy, 1000), textIssue(w.guarantee, 300), wholeNumberIssue(r.windowDays, 0, 365)]
    .filter((m): m is string => Boolean(m))
    .map((message) => ({ tab: "warranty", section: "Warranty & rework", message }));
}

export function WarrantySection({
  warranty: w,
  rework: r,
  onWarranty,
  onRework,
  legacyWarrantyDays,
}: {
  warranty: WarrantyForm;
  rework: ReworkForm;
  onWarranty: (next: WarrantyForm) => void;
  onRework: (next: ReworkForm) => void;
  /** `quality.warrantyDays` from the Quality tab, to say plainly which of the two is in force. */
  legacyWarrantyDays: string;
}) {
  const set = <K extends keyof WarrantyForm>(k: K, v: WarrantyForm[K]) => onWarranty({ ...w, [k]: v });
  const toggleType = (t: string) => set("eligibleIssueTypes", w.eligibleIssueTypes.includes(t) ? w.eligibleIssueTypes.filter((x) => x !== t) : [...w.eligibleIssueTypes, t]);
  return (
    <>
      <Section title="Warranty" hint="What the customer is promised after the job. Frozen into each booking when it is made — changes apply to future bookings only." open>
        <Toggle label="Warranty enabled" consumer="Booking snapshot" checked={w.enabled} onChange={(v) => set("enabled", v)} />
        {legacyWarrantyDays.trim() && Number(legacyWarrantyDays) > 0 ? (
          <p className="text-xs text-[var(--color-biz-muted)]">
            The Quality tab also has “Warranty days” ({legacyWarrantyDays.trim()}). Once anything on this page is saved, this policy replaces that number — with the warranty switched off here, the service has no warranty.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (days)" consumer="Customer" error={durationIssue(w)}>
            <input className="sv-input" type="number" min={0} max={3650} value={w.durationDays} onChange={(x) => set("durationDays", x.target.value)} />
          </Field>
          <Field label="Starts from" consumer="Warranty window">
            <select className="sv-input" value={w.startEvent} onChange={(x) => set("startEvent", x.target.value)}>
              <option value="">Default (job completion)</option>
              <option value="COMPLETION">Job completion</option>
              <option value="CONFIRMATION">Customer confirmation</option>
            </select>
          </Field>
        </div>
        <fieldset className="sv-field">
          <legend className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--color-biz-muted)]">Issues covered</legend>
          <div className="flex flex-wrap gap-3">
            {ISSUE_TYPES.map(([t, label]) => (
              <Toggle key={t} label={label} checked={w.eligibleIssueTypes.includes(t)} onChange={() => toggleType(t)} />
            ))}
          </div>
          <small className="text-xs text-[var(--color-biz-muted)]">None selected = the platform default: poor quality and incomplete work.</small>
        </fieldset>
        <LinesField label="Exclusions" consumer="Customer" value={w.exclusions} onChange={(v) => set("exclusions", v)} maxItems={20} maxLen={300} placeholder="Damage caused after the visit" />
        <div className="flex flex-wrap gap-3">
          <Toggle label="Proof required to claim" consumer="Case intake" checked={w.proofRequired} onChange={(v) => set("proofRequired", v)} />
          <Toggle label="Offer a free rework before any refund" consumer="Case decision" checked={w.reworkFirst} onChange={(v) => set("reworkFirst", v)} />
          <Toggle label="Refund allowed" consumer="Case decision" checked={w.refundAllowed} onChange={(v) => set("refundAllowed", v)} />
        </div>
        <Field label="Service guarantee" consumer="Customer — shown verbatim" error={textIssue(w.guarantee, 300)}>
          <textarea className="sv-input sv-textarea" rows={2} value={w.guarantee} onChange={(x) => set("guarantee", x.target.value)} />
        </Field>
        <Field label="Damage policy" consumer="Customer — shown verbatim" error={textIssue(w.damagePolicy, 1000)} help="How damage caused during the visit is handled.">
          <textarea className="sv-input sv-textarea" rows={3} value={w.damagePolicy} onChange={(x) => set("damagePolicy", x.target.value)} />
        </Field>
      </Section>
      <Section title="Rework" hint="How a return visit is handled when a complaint is upheld. The customer never chooses the fee — the case decides from this policy.">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Rework fee"
            consumer="Case decision"
            help={
              r.fee === "WAIVED"
                ? undefined
                : r.fee === "QUOTED"
                  ? "A quoted rework has no price the platform can apply yet: a rework decision on a case is refused until the owner approves one."
                  : "Without a fee policy a rework visit cannot be created from a case. Choose “Waived” to allow free reworks."
            }
          >
            <select className="sv-input" value={r.fee} onChange={(x) => onRework({ ...r, fee: x.target.value })}>
              <option value="">Not set — no rework visits</option>
              <option value="WAIVED">Waived — free for the customer</option>
              <option value="QUOTED">Quoted — needs owner approval</option>
            </select>
          </Field>
          <Field label="Rework window (days)" consumer="Case decision" error={wholeNumberIssue(r.windowDays, 0, 365)}>
            <input className="sv-input" type="number" min={0} max={365} value={r.windowDays} onChange={(x) => onRework({ ...r, windowDays: x.target.value })} />
          </Field>
        </div>
        <Toggle label="Prefer the same professional for the rework" consumer="Rework case" checked={r.sameProviderPreferred} onChange={(v) => onRework({ ...r, sameProviderPreferred: v })} />
      </Section>
    </>
  );
}
