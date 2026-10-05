"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ExecutionStepConfig, ServiceCatalogConfig } from "@/services/admin-api";
import { CODE_RE, EmptyRow, Field, LinesField, Section, Toggle, clean, csv, lines, listIssue, listOrUndefined, num, str, unlessDefault, wholeNumberIssue, type ConfigIssue } from "./config-form";

/**
 * Phase 10 §7 — the work plan: the ordered steps a professional follows on the job
 * (`catalogConfig.execution.steps`, backend lib/service-execution.ts). A booking freezes the steps
 * that apply to its selection, so an edit here only reaches FUTURE bookings.
 *
 * Nothing is pre-filled: a service without steps has no plan and gates nothing.
 */

const STEP_KINDS = [
  ["PREPARATION", "Preparation"],
  ["WORK", "Work"],
  ["SAFETY_CHECK", "Safety check"],
  ["QUALITY_CHECK", "Quality check"],
  ["CLOSEOUT", "Close-out"],
] as const;
const STEP_EVIDENCE = [
  ["NONE", "No proof"],
  ["NOTE", "Written note"],
  ["PHOTO", "Photo"],
  ["BEFORE_AFTER_PHOTOS", "Before and after photos"],
] as const;
export const MAX_STEPS = 40;
const MAX_DEPENDS = 10;
/** Requirement enforcements a step's safety link may point at; anything weaker gates nothing. */
const ENFORCED = ["REQUIRED_BEFORE_BOOKING", "REQUIRED_BEFORE_ARRIVAL", "REQUIRED_AT_START"];

/** One step as edited (strings for inputs). `key` is editor-only identity for collapse state; it is never saved. */
export type StepRow = {
  key: string;
  id: string;
  title: string;
  description: string;
  kind: string;
  mandatory: boolean;
  skipPolicy: string;
  evidence: string;
  estimatedMinutes: string;
  dependsOn: string[];
  safetyRequirement: string;
  ppe: string;
  warnings: string;
  materials: string;
  equipment: string;
  whenVariants: string;
  whenAddons: string;
  whenMinQuantity: string;
  sortOrder: string;
  active: boolean;
};

/** What the plan is checked against: this service's requirement assignments, variants and add-ons. */
export type PlanContext = {
  requirements: { id: string; enforcement: string; active: boolean }[];
  variantIds: string[];
  addonIds: string[];
};

/** Stored steps → rows, in the order the professional sees them (sortOrder, then id — the backend's order). */
export function stepsFromConfig(c: ServiceCatalogConfig): StepRow[] {
  return [...(c.execution?.steps ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
    .map((s, i) => ({
      key: "s" + i,
      id: s.id,
      title: s.title,
      description: s.description ?? "",
      kind: s.kind,
      mandatory: s.mandatory !== false,
      skipPolicy: s.skipPolicy ?? "NOT_SKIPPABLE",
      evidence: s.evidence ?? "NONE",
      estimatedMinutes: str(s.estimatedMinutes),
      dependsOn: s.dependsOn ?? [],
      safetyRequirement: s.safetyRequirement ?? "",
      ppe: lines(s.ppe),
      warnings: lines(s.warnings),
      materials: lines(s.materials),
      equipment: lines(s.equipment),
      whenVariants: (s.when?.variantIds ?? []).join(", "),
      whenAddons: (s.when?.addonIds ?? []).join(", "),
      whenMinQuantity: str(s.when?.minQuantity),
      sortOrder: str(s.sortOrder),
      active: s.active !== false,
    }));
}

/** Rows → `execution` (undefined when there are no steps, so the key is removed). Merged by step id. */
export function stepsToConfig(rows: StepRow[], base?: ServiceCatalogConfig["execution"]): ServiceCatalogConfig["execution"] {
  if (!rows.length) return undefined;
  const prev = new Map((base?.steps ?? []).map((s) => [s.id, s]));
  return {
    ...(base ?? {}),
    steps: rows.map((r) => {
      const id = r.id.trim();
      const p = prev.get(id);
      const dependsOn = r.dependsOn.filter((d) => d && d !== id);
      return clean({
        ...(p ?? {}),
        id,
        title: r.title.trim(),
        description: r.description.trim() || undefined,
        kind: r.kind as ExecutionStepConfig["kind"],
        mandatory: unlessDefault(p, "mandatory", r.mandatory, true),
        // A mandatory step is never skippable, whatever the select last held.
        skipPolicy: unlessDefault(p, "skipPolicy", r.mandatory ? "NOT_SKIPPABLE" : r.skipPolicy, "NOT_SKIPPABLE") as ExecutionStepConfig["skipPolicy"],
        evidence: unlessDefault(p, "evidence", r.evidence, "NONE") as ExecutionStepConfig["evidence"],
        estimatedMinutes: num(r.estimatedMinutes),
        dependsOn: dependsOn.length ? dependsOn : undefined,
        safetyRequirement: r.safetyRequirement.trim() || undefined,
        ppe: listOrUndefined(r.ppe),
        warnings: listOrUndefined(r.warnings),
        materials: listOrUndefined(r.materials),
        equipment: listOrUndefined(r.equipment),
        when: clean({
          variantIds: csv(r.whenVariants).length ? csv(r.whenVariants) : undefined,
          addonIds: csv(r.whenAddons).length ? csv(r.whenAddons) : undefined,
          minQuantity: num(r.whenMinQuantity),
        }),
        sortOrder: num(r.sortOrder),
        active: unlessDefault(p, "active", r.active, true),
      })!;
    }),
  };
}

type StepErrors = Partial<Record<"id" | "title" | "description" | "estimatedMinutes" | "dependsOn" | "safetyRequirement" | "ppe" | "warnings" | "materials" | "equipment" | "when", string>>;

const conditional = (r: StepRow) => csv(r.whenVariants).length > 0 || csv(r.whenAddons).length > 0 || r.whenMinQuantity.trim() !== "";

/**
 * Per-step problems, index-aligned with `rows`. Mirrors the backend's schema and
 * `validateExecutionPlan`: each of these would either refuse the save or leave the service unbookable.
 */
export function stepErrors(rows: StepRow[], ctx: PlanContext): StepErrors[] {
  const ids = rows.map((r) => r.id.trim());
  const activeIds = new Set(rows.filter((r) => r.active).map((r) => r.id.trim()));
  const reqs = new Map(ctx.requirements.filter((r) => r.active).map((r) => [r.id.trim(), r.enforcement]));
  const byId = new Map(rows.map((r) => [r.id.trim(), r]));
  // Dependency cycles among active steps.
  const inCycle = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      for (const p of path.slice(path.indexOf(id))) inCycle.add(p);
      return;
    }
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOn ?? []) if (activeIds.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const id of activeIds) visit(id, []);

  return rows.map((r, i) => {
    const e: StepErrors = {};
    const id = ids[i]!;
    if (!id) e.id = "A step code is required.";
    else if (id.length > 60 || !CODE_RE.test(id)) e.id = "Lowercase letters and digits, words joined by single hyphens (max 60).";
    else if (ids.indexOf(id) !== i) e.id = "Another step already uses this code.";
    if (!r.title.trim()) e.title = "A title is required.";
    else if (r.title.trim().length > 120) e.title = "At most 120 characters.";
    if (r.description.trim().length > 1000) e.description = "At most 1000 characters.";
    e.estimatedMinutes = wholeNumberIssue(r.estimatedMinutes, 1, 600);
    const deps = r.dependsOn.filter((d) => d !== id);
    if (deps.length > MAX_DEPENDS) e.dependsOn = `At most ${MAX_DEPENDS} dependencies.`;
    else if (r.active) {
      const missing = deps.find((d) => !activeIds.has(d));
      const cond = r.mandatory && !conditional(r) ? deps.find((d) => byId.get(d) && conditional(byId.get(d)!)) : undefined;
      if (missing) e.dependsOn = `"${missing}" is not an active step.`;
      else if (inCycle.has(id)) e.dependsOn = "These steps depend on each other in a loop.";
      else if (cond) e.dependsOn = `A mandatory step cannot depend on "${cond}", which only applies to some bookings.`;
    }
    const link = r.safetyRequirement.trim();
    if (link && r.active) {
      const enforcement = reqs.get(link);
      if (!enforcement) e.safetyRequirement = `"${link}" is not an active requirement of this service.`;
      else if (!ENFORCED.includes(enforcement)) e.safetyRequirement = `"${link}" is informational only — link a requirement that is enforced.`;
    }
    e.ppe = listIssue(r.ppe, 10, 80);
    e.warnings = listIssue(r.warnings, 10, 300);
    e.materials = listIssue(r.materials, 15, 120);
    e.equipment = listIssue(r.equipment, 15, 120);
    if (r.active) {
      const badVariant = csv(r.whenVariants).find((v) => !ctx.variantIds.includes(v));
      const badAddon = csv(r.whenAddons).find((a) => !ctx.addonIds.includes(a));
      if (badVariant) e.when = `Variant "${badVariant}" does not exist or is inactive.`;
      else if (badAddon) e.when = `Add-on "${badAddon}" does not exist or is inactive on this service.`;
    }
    if (!e.when) e.when = wholeNumberIssue(r.whenMinQuantity, 1, 10_000);
    return clean(e) ?? {};
  });
}

export function planIssues(rows: StepRow[], ctx: PlanContext): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  if (rows.length > MAX_STEPS) out.push({ tab: "workplan", section: "Work plan", message: `At most ${MAX_STEPS} steps.` });
  stepErrors(rows, ctx).forEach((e, i) => {
    for (const message of Object.values(e)) out.push({ tab: "workplan", section: "Work plan", message: `Step ${i + 1}: ${message}` });
  });
  return out;
}

/** Any structural change renumbers every step, so the saved order is exactly the order shown. */
const renumber = (rows: StepRow[]): StepRow[] => rows.map((r, i) => ({ ...r, sortOrder: String((i + 1) * 10) }));

const emptyStep = (key: string): StepRow => ({
  key,
  id: "",
  title: "",
  description: "",
  kind: "WORK",
  mandatory: true,
  skipPolicy: "NOT_SKIPPABLE",
  evidence: "NONE",
  estimatedMinutes: "",
  dependsOn: [],
  safetyRequirement: "",
  ppe: "",
  warnings: "",
  materials: "",
  equipment: "",
  whenVariants: "",
  whenAddons: "",
  whenMinQuantity: "",
  sortOrder: "",
  active: true,
});

export function ExecutionPlanSection({ rows, onChange, context }: { rows: StepRow[]; onChange: (rows: StepRow[]) => void; context: PlanContext }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const errors = stepErrors(rows, context);
  const upd = (i: number, patch: Partial<StepRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (key: string) => setOpen((s) => new Set(s.has(key) ? [...s].filter((k) => k !== key) : [...s, key]));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row!);
    onChange(renumber(next));
  };
  const add = () => {
    // A key no existing row holds, stable across re-renders (never random: the form is compared as JSON).
    const key = "n" + (Math.max(-1, ...rows.map((r) => Number(r.key.slice(1)) || 0)) + 1);
    onChange(renumber([...rows, emptyStep(key)]));
    setOpen((s) => new Set([...s, key]));
  };
  // Renaming a step keeps the steps that depend on it pointing at it.
  const rename = (i: number, id: string) => {
    const was = rows[i]!.id;
    onChange(rows.map((r, j) => (j === i ? { ...r, id } : was && r.dependsOn.includes(was) ? { ...r, dependsOn: r.dependsOn.map((d) => (d === was ? id : d)) } : r)));
  };
  const remove = (i: number) => {
    const gone = rows[i]!.id;
    onChange(renumber(rows.filter((_, j) => j !== i).map((r) => (gone && r.dependsOn.includes(gone) ? { ...r, dependsOn: r.dependsOn.filter((d) => d !== gone) } : r))));
  };
  const totalMinutes = rows.reduce((sum, r) => sum + (r.active ? (num(r.estimatedMinutes) ?? 0) : 0), 0);

  return (
    <Section
      title={`Work plan (${rows.length})`}
      hint="The steps a professional follows on the job, in order. Mandatory steps must be completed before the job can be marked done. Changes apply to future bookings only — a booking keeps the plan it was made with."
      open
    >
      {rows.length === 0 ? <EmptyRow>No steps yet — add the first step. A service without a work plan has no step-by-step gate.</EmptyRow> : null}
      {rows.map((r, i) => {
        const err = errors[i] ?? {};
        const errorCount = Object.keys(err).length;
        const isOpen = open.has(r.key);
        const others = rows.filter((_, j) => j !== i && rows[j]!.id.trim());
        const panelId = "step-panel-" + r.key;
        return (
          <div key={r.key} className="grid gap-2 rounded-lg border border-[var(--color-biz-line)] p-2" data-testid="execution-step-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => toggle(r.key)} aria-expanded={isOpen} aria-controls={panelId}>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-biz-elevated)] text-xs font-semibold tabular-nums" aria-label={`Step ${i + 1}`}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.title.trim() || "Untitled step"}</span>
                  <span className="block truncate text-xs text-[var(--color-biz-muted)]">
                    {[
                      r.id.trim() || "no code",
                      STEP_KINDS.find(([k]) => k === r.kind)?.[1] ?? r.kind,
                      r.mandatory ? "mandatory" : "optional",
                      r.evidence !== "NONE" ? (STEP_EVIDENCE.find(([k]) => k === r.evidence)?.[1] ?? r.evidence).toLowerCase() : null,
                      r.estimatedMinutes.trim() ? r.estimatedMinutes.trim() + " min" : null,
                      r.active ? null : "inactive",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {errorCount > 0 ? (
                  <span className="shrink-0 rounded-full border border-[var(--color-biz-danger)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-biz-danger)]">
                    {errorCount} to fix
                  </span>
                ) : null}
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" className="biz-btn text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button type="button" className="biz-btn text-xs" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button type="button" className="biz-btn text-xs" onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {isOpen ? (
              <div id={panelId} className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Step title" consumer="Professional" error={err.title}>
                    <input className="sv-input" value={r.title} maxLength={120} onChange={(x) => upd(i, { title: x.target.value })} placeholder="Protect floors and furniture" />
                  </Field>
                  <Field label="Step code" error={err.id} help="Permanent id used in records. Lowercase, hyphens.">
                    <input className="sv-input" value={r.id} maxLength={60} onChange={(x) => rename(i, x.target.value)} placeholder="protect-area" />
                  </Field>
                </div>
                <Field label="Description" consumer="Professional" error={err.description}>
                  <textarea className="sv-input sv-textarea" rows={2} value={r.description} maxLength={1000} onChange={(x) => upd(i, { description: x.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kind">
                    <select className="sv-input" value={r.kind} onChange={(x) => upd(i, { kind: x.target.value })}>
                      {STEP_KINDS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Estimated time (minutes)" error={err.estimatedMinutes}>
                    <input className="sv-input" type="number" min={1} max={600} value={r.estimatedMinutes} onChange={(x) => upd(i, { estimatedMinutes: x.target.value })} />
                  </Field>
                  <Field label="Proof" consumer="Completion gate">
                    <select className="sv-input" value={r.evidence} onChange={(x) => upd(i, { evidence: x.target.value })}>
                      {STEP_EVIDENCE.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Skipping" help={r.mandatory ? "A mandatory step can never be skipped." : undefined}>
                    <select className="sv-input" value={r.mandatory ? "NOT_SKIPPABLE" : r.skipPolicy} disabled={r.mandatory} onChange={(x) => upd(i, { skipPolicy: x.target.value })}>
                      <option value="NOT_SKIPPABLE">Cannot be skipped</option>
                      <option value="SKIP_WITH_REASON">May be skipped with a reason</option>
                    </select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Toggle label="Mandatory" consumer="Completion gate" checked={r.mandatory} onChange={(v) => upd(i, v ? { mandatory: true, skipPolicy: "NOT_SKIPPABLE" } : { mandatory: false })} />
                  <Toggle label="Active" checked={r.active} onChange={(v) => upd(i, { active: v })} />
                </div>
                <fieldset className="sv-field">
                  <legend className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--color-biz-muted)]">Must come after</legend>
                  {others.length === 0 ? (
                    <p className="text-xs text-[var(--color-biz-muted)]">No other steps to depend on yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {others.map((o) => (
                        <Toggle
                          key={o.key}
                          label={o.title.trim() || o.id.trim()}
                          checked={r.dependsOn.includes(o.id.trim())}
                          onChange={(v) => upd(i, { dependsOn: v ? [...r.dependsOn, o.id.trim()] : r.dependsOn.filter((d) => d !== o.id.trim()) })}
                        />
                      ))}
                    </div>
                  )}
                  {err.dependsOn ? (
                    <small className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
                      {err.dependsOn}
                    </small>
                  ) : null}
                </fieldset>
                <Field
                  label="Safety requirement"
                  consumer="Start gate"
                  error={err.safetyRequirement}
                  help="The step cannot start until this requirement is satisfied. Requirements are assigned on the Requirements tab."
                >
                  <select className="sv-input" value={r.safetyRequirement} onChange={(x) => upd(i, { safetyRequirement: x.target.value })}>
                    <option value="">None</option>
                    {r.safetyRequirement && !context.requirements.some((q) => q.id === r.safetyRequirement) ? <option value={r.safetyRequirement}>{r.safetyRequirement} (not assigned)</option> : null}
                    {context.requirements.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.id} · {q.enforcement.replace(/_/g, " ").toLowerCase()}
                        {q.active ? "" : " · inactive"}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <LinesField label="Materials" consumer="Professional" value={r.materials} onChange={(v) => upd(i, { materials: v })} maxItems={15} maxLen={120} rows={2} />
                  <LinesField label="Equipment" consumer="Professional" value={r.equipment} onChange={(v) => upd(i, { equipment: v })} maxItems={15} maxLen={120} rows={2} />
                  <LinesField label="Protective equipment" consumer="Professional" value={r.ppe} onChange={(v) => upd(i, { ppe: v })} maxItems={10} maxLen={80} rows={2} />
                  <LinesField label="Warnings" consumer="Professional" value={r.warnings} onChange={(v) => upd(i, { warnings: v })} maxItems={10} maxLen={300} rows={2} />
                </div>
                <fieldset className="sv-field">
                  <legend className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--color-biz-muted)]">Only applies when (leave empty for every booking)</legend>
                  <div className="grid grid-cols-3 gap-2">
                    <input className="sv-input" placeholder={"variants (" + (context.variantIds.join(", ") || "none") + ")"} value={r.whenVariants} onChange={(x) => upd(i, { whenVariants: x.target.value })} aria-label="Condition variant ids" />
                    <input className="sv-input" placeholder={"add-ons (" + (context.addonIds.join(", ") || "none") + ")"} value={r.whenAddons} onChange={(x) => upd(i, { whenAddons: x.target.value })} aria-label="Condition add-on ids" />
                    <input className="sv-input" type="number" min={1} placeholder="from quantity" value={r.whenMinQuantity} onChange={(x) => upd(i, { whenMinQuantity: x.target.value })} aria-label="Condition minimum quantity" />
                  </div>
                  {err.when ? (
                    <small className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
                      {err.when}
                    </small>
                  ) : null}
                </fieldset>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="biz-btn self-start text-xs" disabled={rows.length >= MAX_STEPS} onClick={add}>
          <Plus className="h-3 w-3" /> Add step
        </button>
        {rows.length > 0 ? (
          <p className="text-xs text-[var(--color-biz-muted)]">
            {rows.length} of {MAX_STEPS} steps{totalMinutes > 0 ? ` · about ${totalMinutes} min of estimated work` : ""}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
