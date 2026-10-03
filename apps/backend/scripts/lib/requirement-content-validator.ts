/**
 * Phase 06 content validation engine (pure; no database). Runs over a content set
 * (catalogue + per-service assignments + meta) and returns findings, a readiness matrix and a
 * per-service quality score. Every rule is deterministic and named, so a test can prove each one
 * fires (defect reintroduction R1–R15) and support can cite why content was refused.
 */
import { requirementAssignmentSchema, resolveServiceRequirements, validateServiceRequirements, ENFORCEMENTS, CHARGES, RESPONSIBILITIES, VERIFICATIONS, type RequirementItemInfo } from "../../src/lib/service-requirements";
import type { ContentAssignment, ContentItem, ServiceContent, ServiceStatus } from "../data/phase-06-requirement-content-final";

export type Finding = { rule: string; severity: "ERROR" | "WARN"; service?: string; item?: string; message: string };
export type Readiness = {
  service: string;
  status: ServiceStatus | "INVALID" | "NOT_CONFIGURED";
  requirement: "CONFIGURED" | "NO_SPECIAL_REQUIREMENTS" | "NOT_CONFIGURED" | "INVALID";
  materials: "CONFIGURED" | "NO_SPECIAL_REQUIREMENTS" | "NOT_CONFIGURED";
  equipment: "CONFIGURED" | "NO_SPECIAL_REQUIREMENTS" | "NOT_CONFIGURED";
  preconditions: "CONFIGURED" | "NO_SPECIAL_REQUIREMENTS" | "NOT_CONFIGURED";
  commercial: "NONE" | "COMMERCIAL_HOLD";
  safety: "NONE" | "INSPECTION_DEPENDENT" | "SAFETY_HOLD";
  customerCopy: "OK" | "DEFECT";
  partnerCopy: "OK" | "DEFECT";
  bookabilityImpact: "NONE" | "BLOCKING_CONFIRMATION";
  blocking: string[];
  assignments: number;
  score: number;
  scoreNotes: string[];
};
export type Report = { version: string; findings: Finding[]; errors: number; warnings: number; readiness: Readiness[]; catalogue: { total: number; byKind: Record<string, number>; unused: string[] }; assignments: number };

const ENUM_TOKENS = [...ENFORCEMENTS, ...CHARGES, ...RESPONSIBILITIES, ...VERIFICATIONS, "CUSTOMER_PRECONDITION", "MATERIAL", "EQUIPMENT", "PER_BOOKING", "PER_SELECTED_UNIT"];
const ENUM_RE = new RegExp(`\\b(${ENUM_TOKENS.join("|")})\\b`);
const INTERNAL_RE = /\b(OWNER_APPROVED|SYSTEM_INFERRED|EXISTING_AUTHORITATIVE|INSPECTION_DEPENDENT|SAFETY_HOLD|COMMERCIAL_HOLD|Assumption A\d|provenance|internalNote|sri_[0-9a-f]{6,})\b/;
const WE_BRING_RE = /\b(we('| wi)?ll bring|we bring|we supply|we provide|our (team|professional) (brings|supplies|provides))\b/i;
const YOU_PROVIDE_RE = /\b(yours to provide|you provide|please (keep|have) .* ready|we use (the|your) )/i;
const MONEY_RE = /(₹|\bRs\.?|\bINR\b|\b\d+\s*(rupees|paise)\b|\bfree\b|\bno (extra )?charge\b|\bincluded in the price\b)/i;
const SAFETY_CLASS = new Set(["SAFETY"]);
/** A work-at-height / certification method HOMEEIGO has never defined. Any mention in customer or partner copy is an unsupported claim. */
const METHOD_CLAIM_RE = /\b(scaffold(ing)?|harness(es)?|rope[- ]access|boom lift|cherry picker|certified|certification|licensed|licence|license|PPE)\b/i;
/** Customer copy of an assessment-dependent precondition must say that coverage depends on the on-site assessment. */
const ASSESSMENT_RE = /\b(assess(es|ed|ment)?|reached safely|not covered|not painted|cannot be reached)\b/i;
const PROMOTION_TEXT = "Promoted under owner's Phase 06 content authorization";

const stem = (t: string) => t.replace(/ies$/, "y").replace(/(es|s)$/, "");
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !["and", "the", "for", "with", "your", "our"].includes(t)).map(stem));
const jaccard = (a: Set<string>, b: Set<string>) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };

export function validateContent(input: { version: string; catalogue: ContentItem[]; content: Record<string, ServiceContent>; liveServices?: string[]; duplicateAllow?: string[][] }): Report {
  const { version, catalogue, content } = input;
  const F: Finding[] = [];
  const err = (rule: string, message: string, ctx: { service?: string; item?: string } = {}) => F.push({ rule, severity: "ERROR", message, ...ctx });
  const warn = (rule: string, message: string, ctx: { service?: string; item?: string } = {}) => F.push({ rule, severity: "WARN", message, ...ctx });

  // ── catalogue ────────────────────────────────────────────────────────────────
  const byCode = new Map<string, ContentItem>();
  for (const it of catalogue) {
    if (byCode.has(it.code)) err("CATALOGUE_DUPLICATE_CODE", `catalogue code ${it.code} appears twice`, { item: it.code });
    byCode.set(it.code, it);
    if (!it.customerLabel?.trim()) err("CATALOGUE_NO_CUSTOMER_LABEL", `${it.code} has no customer label`, { item: it.code });
    if (it.kind === "CUSTOMER_PRECONDITION" && !it.preconditionClass) err("PRECONDITION_UNCLASSIFIED", `${it.code} has no precondition class`, { item: it.code });
    for (const text of [it.name, it.customerLabel]) if (ENUM_RE.test(text) || INTERNAL_RE.test(text)) err("LEAK_ENUM_IN_LABEL", `${it.code}: label/name carries an enum or internal token`, { item: it.code });
  }
  const allow = new Set((input.duplicateAllow ?? []).map((p) => [...p].sort().join("|")));
  for (let i = 0; i < catalogue.length; i++) for (let j = i + 1; j < catalogue.length; j++) {
    const a = catalogue[i]!, b = catalogue[j]!;
    if (a.kind !== b.kind) continue;
    const sim = jaccard(tokens(a.name), tokens(b.name));
    if (sim >= 0.6 && !allow.has([a.code, b.code].sort().join("|"))) err("CATALOGUE_SEMANTIC_DUPLICATE", `${a.code} and ${b.code} look like one concept (similarity ${sim.toFixed(2)}) — merge or allow-list with a reason`, { item: a.code });
  }
  const items: Record<string, RequirementItemInfo> = Object.fromEntries(catalogue.map((i) => [i.code, { code: i.code, kind: i.kind, name: i.name, customerLabel: i.customerLabel, description: i.description, isActive: true }]));

  // ── coverage of the live universe ────────────────────────────────────────────
  const live = input.liveServices ?? Object.keys(content);
  for (const s of live) if (!content[s]) err("SERVICE_NOT_COVERED", `live service ${s} has no content entry (NOT_CONFIGURED is not a silent state)`, { service: s });
  for (const s of Object.keys(content)) if (!live.includes(s)) warn("CONTENT_FOR_UNKNOWN_SERVICE", `${s} is not in the live service list`, { service: s });

  // ── per service ──────────────────────────────────────────────────────────────
  const readiness: Readiness[] = [];
  const used = new Set<string>();
  let assignmentsTotal = 0;
  for (const [slug, svc] of Object.entries(content)) {
    const before = F.length;
    const parsed: ContentAssignment[] = [];
    const ids = new Set<string>();
    for (const a of svc.assignments) {
      const { meta, ...persisted } = a;
      const r = requirementAssignmentSchema.safeParse(persisted);
      if (!r.success) { err("SCHEMA", `${slug}/${a.id}: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`, { service: slug, item: a.id }); continue; }
      if (ids.has(a.id)) err("DUPLICATE_ASSIGNMENT_ID", `${slug}: assignment id ${a.id} appears twice`, { service: slug, item: a.id });
      ids.add(a.id);
      const it = byCode.get(a.itemCode);
      if (!it) { err("ITEM_UNKNOWN", `${slug}/${a.id}: catalogue code ${a.itemCode} does not exist`, { service: slug, item: a.id }); continue; }
      used.add(a.itemCode);
      const p = { ...r.data, meta } as ContentAssignment;
      parsed.push(p);
      const copy = [p.customerNote, p.customerWarning].filter(Boolean).join(" ");
      const partner = [p.partnerInstructions, p.handlingNote].filter(Boolean).join(" ");

      // responsibility ↔ kind ↔ charge semantics (R1 / R2)
      if (it.kind === "CUSTOMER_PRECONDITION" && p.responsibility !== "CUSTOMER") err("PRECONDITION_NOT_CUSTOMER", `${slug}/${p.id}: a customer precondition must have responsibility CUSTOMER`, { service: slug, item: p.id });
      if (it.kind !== "CUSTOMER_PRECONDITION" && p.responsibility === "PROFESSIONAL" && p.charge === "NOT_APPLICABLE") err("PROFESSIONAL_ITEM_WITHOUT_CHARGE_SEMANTICS", `${slug}/${p.id}: a professional-provided item must say INCLUDED, SEPARATE_QUOTE or CHARGEABLE`, { service: slug, item: p.id });
      if (p.responsibility === "UNKNOWN") err("RESPONSIBILITY_UNDECIDED", `${slug}/${p.id}: responsibility UNKNOWN cannot be published`, { service: slug, item: p.id });
      // copy ↔ data (R5)
      if (p.responsibility === "CUSTOMER" && WE_BRING_RE.test(copy)) err("COPY_SAYS_WE_BRING_BUT_CUSTOMER_PROVIDES", `${slug}/${p.id}: customer copy says "we bring" but responsibility is CUSTOMER`, { service: slug, item: p.id });
      if (p.responsibility === "PROFESSIONAL" && YOU_PROVIDE_RE.test(copy)) err("COPY_SAYS_YOU_PROVIDE_BUT_PROFESSIONAL_PROVIDES", `${slug}/${p.id}: customer copy asks the customer to provide an item the professional brings`, { service: slug, item: p.id });
      if (p.charge === "SEPARATE_QUOTE" && MONEY_RE.test(copy)) err("SEPARATE_QUOTE_COPY_STATES_MONEY", `${slug}/${p.id}: a separately quoted item must not state an amount, "free" or "included"`, { service: slug, item: p.id });
      if (p.charge === "INCLUDED" && /\b(extra|additional) (cost|charge|fee)\b|\bquoted\b/i.test(copy)) err("INCLUDED_COPY_MENTIONS_CHARGE", `${slug}/${p.id}: an included item must not mention an extra charge`, { service: slug, item: p.id });
      if (p.charge === "SEPARATE_QUOTE" && !/\b(confirm|confirms|confirmed)\b/i.test(copy)) err("SEPARATE_QUOTE_COPY_MUST_PROMISE_CONFIRMATION", `${slug}/${p.id}: separately quoted copy must say the need/cost is confirmed with the customer before use`, { service: slug, item: p.id });
      // commercial (R12)
      if (p.charge === "CHARGEABLE") err("CHARGEABLE_WITHOUT_ADDON_PATH", `${slug}/${p.id}: CHARGEABLE needs a live add-on that prices it; none exists in the live catalogue`, { service: slug, item: p.id });
      if (p.charge === "SEPARATE_QUOTE" && svc.status !== "COMMERCIAL_HOLD") err("SEPARATE_QUOTE_WITHOUT_COMMERCIAL_HOLD", `${slug}/${p.id}: a separately quoted item exists but the service is not on COMMERCIAL_HOLD (no in-app quote chain)`, { service: slug, item: p.id });
      if (p.charge === "SEPARATE_QUOTE" && p.meta?.provenance !== "COMMERCIAL_HOLD") err("SEPARATE_QUOTE_PROVENANCE", `${slug}/${p.id}: separately quoted items carry provenance COMMERCIAL_HOLD`, { service: slug, item: p.id });
      // enforcement ↔ verification coherence
      const required = p.enforcement.startsWith("REQUIRED");
      if (required && p.verification === "NONE") err("REQUIRED_WITHOUT_VERIFICATION", `${slug}/${p.id}: ${p.enforcement} needs a verification method`, { service: slug, item: p.id });
      if (!required && p.verification !== "NONE") err("VERIFICATION_WITHOUT_ENFORCEMENT", `${slug}/${p.id}: verification ${p.verification} on a non-required item is meaningless`, { service: slug, item: p.id });
      if (p.enforcement === "REQUIRED_BEFORE_BOOKING" && it.kind !== "CUSTOMER_PRECONDITION") err("BLOCKING_MUST_BE_PRECONDITION", `${slug}/${p.id}: only a customer precondition may block a booking`, { service: slug, item: p.id });
      // safety (R11): a SAFETY-class precondition must be verified by someone, never merely advised
      if (it.preconditionClass && SAFETY_CLASS.has(it.preconditionClass) && !required) err("SAFETY_PRECONDITION_NOT_VERIFIED", `${slug}/${p.id}: SAFETY precondition ${it.code} is only ${p.enforcement}; it must be verified (REQUIRED_* + PARTNER_CHECK / attestation)`, { service: slug, item: p.id });
      if (it.preconditionClass && SAFETY_CLASS.has(it.preconditionClass) && !copy) err("SAFETY_PRECONDITION_HIDDEN", `${slug}/${p.id}: a SAFETY precondition must tell the customer what to do`, { service: slug, item: p.id });
      // hidden customer obligation (R3): partner copy imposes a customer duty the customer is never told
      if (/\bcustomer (must|should|has to|needs to)\b/i.test(partner) && !copy) err("HIDDEN_CUSTOMER_OBLIGATION", `${slug}/${p.id}: partner copy states a customer obligation but there is no customer copy`, { service: slug, item: p.id });
      // leakage (R15)
      for (const [field, text] of [["customerNote", p.customerNote], ["customerWarning", p.customerWarning], ["partnerInstructions", p.partnerInstructions], ["handlingNote", p.handlingNote]] as const) {
        if (text && (ENUM_RE.test(text) || INTERNAL_RE.test(text))) err("LEAK_ENUM_OR_INTERNAL_IN_COPY", `${slug}/${p.id}: ${field} carries an enum or internal token`, { service: slug, item: p.id });
        if (text && /\bundefined\b|\bnull\b/.test(text)) err("COPY_UNDEFINED", `${slug}/${p.id}: ${field} contains undefined/null`, { service: slug, item: p.id });
      }
      // customer copy must add information, not repeat the item label (the customer would read the same sentence twice)
      if (p.customerNote) { const nz = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/s+/g, " ").trim(); const L = nz(it.customerLabel), N = nz(p.customerNote); if (N === L || N.startsWith(L) || L.startsWith(N)) err("COPY_DUPLICATES_LABEL", `${slug}/${p.id}: customer note repeats the item label`, { service: slug, item: p.id }); }
      // customer copy required whenever the customer must act
      if (p.responsibility === "CUSTOMER" && !copy) err("CUSTOMER_ACTION_WITHOUT_COPY", `${slug}/${p.id}: the customer must act but is told nothing`, { service: slug, item: p.id });
      if (copy.length > 320) warn("COPY_LONG", `${slug}/${p.id}: customer copy is ${copy.length} chars — keep it to one instruction and one reason`, { service: slug, item: p.id });
      // provenance
      if (!p.meta?.provenance) err("PROVENANCE_MISSING", `${slug}/${p.id}: no provenance`, { service: slug, item: p.id });
      if (!p.internalNote?.includes(`[${p.meta?.provenance}`)) err("PROVENANCE_NOT_IN_INTERNAL_NOTE", `${slug}/${p.id}: internal note must carry the provenance tag`, { service: slug, item: p.id });
      if (p.meta?.provenance === "SYSTEM_INFERRED" && !p.meta.assumption) err("INFERENCE_WITHOUT_ASSUMPTION", `${slug}/${p.id}: SYSTEM_INFERRED content must cite an assumption id`, { service: slug, item: p.id });
      // A1–A3 provenance: an assumption line is either still SYSTEM_INFERRED, or OWNER_APPROVED with the promotion reason in the audit note.
      if (p.meta?.assumption && p.meta.provenance !== "SYSTEM_INFERRED" && p.meta.provenance !== "OWNER_APPROVED") err("ASSUMPTION_PROVENANCE_OVERWRITTEN", `${slug}/${p.id}: assumption ${p.meta.assumption} carries provenance ${p.meta.provenance} — only SYSTEM_INFERRED or a traced OWNER_APPROVED promotion is valid`, { service: slug, item: p.id });
      if (p.meta?.assumption && p.meta.provenance === "OWNER_APPROVED" && !(p.meta.promotion?.startsWith(PROMOTION_TEXT) && p.internalNote?.includes(PROMOTION_TEXT))) err("PROMOTION_WITHOUT_TRACE", `${slug}/${p.id}: assumption ${p.meta.assumption} promoted to OWNER_APPROVED without the promotion reason in meta and internal note`, { service: slug, item: p.id });
      if (p.meta?.promotion && !p.meta.assumption) err("PROMOTION_WITHOUT_ASSUMPTION", `${slug}/${p.id}: a promotion must name the assumption it resolves`, { service: slug, item: p.id });
      // Safety (S2): an inspection- or safety-dependent material/equipment line may not promise provision "included in the price".
      if (it.kind !== "CUSTOMER_PRECONDITION" && (p.meta?.provenance === "SAFETY_HOLD" || p.meta?.provenance === "INSPECTION_DEPENDENT") && p.charge === "INCLUDED") err("UNSUPPORTED_EQUIPMENT_PROMISE", `${slug}/${p.id}: a safety/inspection-dependent ${it.kind.toLowerCase()} is shown as brought and included — nothing defines it`, { service: slug, item: p.id });
      // Safety (S3): no copy may claim a work-at-height or certification method.
      for (const [field, text] of [["customerNote", p.customerNote], ["customerWarning", p.customerWarning], ["partnerInstructions", p.partnerInstructions], ["handlingNote", p.handlingNote]] as const) if (text && METHOD_CLAIM_RE.test(text)) err("METHOD_CLAIM_UNSUPPORTED", `${slug}/${p.id}: ${field} claims a method/certification HOMEEIGO has not defined`, { service: slug, item: p.id });
      if (METHOD_CLAIM_RE.test(it.name) || METHOD_CLAIM_RE.test(it.customerLabel)) err("METHOD_CLAIM_UNSUPPORTED", `${slug}/${p.id}: catalogue label ${it.code} claims an undefined method/certification`, { service: slug, item: p.id });
      // Safety (S4): an assessment-dependent precondition must tell the customer coverage depends on the assessment.
      if (it.kind === "CUSTOMER_PRECONDITION" && (p.meta?.provenance === "SAFETY_HOLD" || p.meta?.provenance === "INSPECTION_DEPENDENT") && !ASSESSMENT_RE.test(copy)) err("SAFETY_COPY_MUST_STATE_ASSESSMENT", `${slug}/${p.id}: customer copy must say coverage depends on the on-site assessment`, { service: slug, item: p.id });
      if (p.quantity != null) err("QUANTITY_NOT_AUTHORISED", `${slug}/${p.id}: quantities are not established by the business`, { service: slug, item: p.id });
      // conditions: no live service has variants/add-ons yet
      if (p.when?.variantIds?.length || p.when?.addonIds?.length) err("CONDITION_WITHOUT_OPTIONS", `${slug}/${p.id}: a variant/add-on condition on a service with no options can never resolve`, { service: slug, item: p.id });
    }
    // gate + resolver (R7 duplicate item / R8 conflict)
    const cfg = { requirements: parsed.map(({ meta: _m, ...a }) => a), requirementItems: items, variants: [], addons: [] } as never;
    for (const i of validateServiceRequirements(cfg)) err("GATE_" + i.code, `${slug}: ${i.message}`, { service: slug, item: i.requirement });
    const res = resolveServiceRequirements(cfg, { variantId: null, addonIds: [], quantity: 1 });
    if (!res.ok) err("RESOLVER_" + res.error, `${slug}: resolver refused`, { service: slug });
    const seenItems = new Map<string, string>();
    for (const p of parsed) { if (seenItems.has(p.itemCode)) err("DUPLICATE_ITEM_IN_SERVICE", `${slug}: ${p.itemCode} assigned twice (${seenItems.get(p.itemCode)} and ${p.id}) with no distinguishing condition`, { service: slug, item: p.id }); seenItems.set(p.itemCode, p.id); }
    const blocking = parsed.filter((p) => p.enforcement === "REQUIRED_BEFORE_BOOKING").map((p) => p.id);
    if (blocking.length > 1) warn("MULTIPLE_BLOCKING", `${slug}: ${blocking.length} booking-blocking confirmations — justify each`, { service: slug });
    // explicit no-special vs configured per kind
    const has = (k: ContentItem["kind"]) => parsed.some((p) => byCode.get(p.itemCode)?.kind === k);
    const state = (k: ContentItem["kind"]) => (has(k) ? "CONFIGURED" : svc.noSpecial?.[k] ? "NO_SPECIAL_REQUIREMENTS" : "NOT_CONFIGURED") as Readiness["materials"];
    // NOT_CONFIGURED is legitimate only when declared with a reason on a SAFETY_HOLD service (no safe definition exists).
    const declaredUnconfigured = (k: ContentItem["kind"]) => !!svc.unconfigured?.[k] && svc.status === "SAFETY_HOLD";
    for (const k of Object.keys(svc.unconfigured ?? {})) {
      if (svc.status !== "SAFETY_HOLD") err("UNCONFIGURED_OUTSIDE_SAFETY_HOLD", `${slug}: ${k} is declared unconfigured but the service is not on SAFETY_HOLD`, { service: slug });
      if (has(k as ContentItem["kind"])) err("UNCONFIGURED_CONTRADICTS_ASSIGNMENT", `${slug}: ${k} is declared unconfigured but has assignments`, { service: slug });
      if (svc.noSpecial?.[k as ContentItem["kind"]]) err("UNCONFIGURED_AND_NO_SPECIAL", `${slug}: ${k} cannot be both unconfigured and "no special requirement"`, { service: slug });
    }
    const mat = state("MATERIAL"), eq = state("EQUIPMENT"), pc = state("CUSTOMER_PRECONDITION");
    for (const [k, st] of [["MATERIAL", mat], ["EQUIPMENT", eq], ["CUSTOMER_PRECONDITION", pc]] as const) if (st === "NOT_CONFIGURED" && !declaredUnconfigured(k)) err("KIND_NOT_DECIDED", `${slug}: ${k} is neither configured nor explicitly declared as needing nothing special`, { service: slug });
    for (const k of Object.keys(svc.noSpecial ?? {})) if (has(k as ContentItem["kind"])) err("NO_SPECIAL_CONTRADICTS_ASSIGNMENT", `${slug}: ${k} is declared "no special requirement" but has assignments`, { service: slug });
    // status ↔ content
    const hasHold = parsed.some((p) => p.meta?.provenance === "SAFETY_HOLD"), hasInspection = parsed.some((p) => p.meta?.provenance === "INSPECTION_DEPENDENT"), hasQuote = parsed.some((p) => p.charge === "SEPARATE_QUOTE");
    if (hasHold && svc.status !== "SAFETY_HOLD") err("STATUS_SAFETY_HOLD_EXPECTED", `${slug}: content carries SAFETY_HOLD provenance but status is ${svc.status}`, { service: slug });
    if (svc.status === "SAFETY_HOLD" && !hasHold) err("STATUS_SAFETY_HOLD_UNFOUNDED", `${slug}: SAFETY_HOLD status without any SAFETY_HOLD content`, { service: slug });
    if (svc.status === "COMMERCIAL_HOLD" && !hasQuote) err("STATUS_COMMERCIAL_HOLD_UNFOUNDED", `${slug}: COMMERCIAL_HOLD status without any separately quoted item`, { service: slug });
    if (svc.status === "READY_WITH_INSPECTION" && !hasInspection) err("STATUS_INSPECTION_UNFOUNDED", `${slug}: READY_WITH_INSPECTION without inspection-dependent content`, { service: slug });
    if (svc.status === "READY" && (hasInspection || hasQuote || hasHold)) err("STATUS_READY_OVERCLAIMED", `${slug}: READY but content carries inspection/quote/safety dependencies`, { service: slug });
    const serviceErrors = F.slice(before).filter((f) => f.severity === "ERROR").length;
    const copyDefect = F.slice(before).some((f) => f.severity === "ERROR" && /COPY|LEAK|HIDDEN|WITHOUT_COPY/.test(f.rule));
    // quality score (internal): coverage, specificity, consistency, clarity, partner usefulness, safety, commercial, duplication, provenance
    const notes: string[] = []; let score = 100;
    if (serviceErrors) { score -= 40; notes.push(`${serviceErrors} error(s)`); }
    if (parsed.length > 10) { score -= 10; notes.push("over-configured (>10 lines)"); }
    if (parsed.filter((p) => p.responsibility === "CUSTOMER" && !p.partnerInstructions && p.enforcement.startsWith("REQUIRED")).length) { score -= 5; notes.push("a verified customer item has no partner instruction"); }
    if (!parsed.some((p) => p.meta?.why)) { score -= 10; notes.push("no rationale"); }
    if (parsed.some((p) => p.meta?.provenance === "SYSTEM_INFERRED")) { score -= 5; notes.push("carries an owner-overridable assumption"); }
    if (hasQuote) { score -= 10; notes.push("commercial chain absent (hold)"); }
    if (hasHold) { score -= 15; notes.push("safety hold"); }
    assignmentsTotal += parsed.length;
    readiness.push({
      service: slug,
      status: serviceErrors ? "INVALID" : svc.status,
      requirement: serviceErrors ? "INVALID" : parsed.length ? "CONFIGURED" : "NO_SPECIAL_REQUIREMENTS",
      materials: mat, equipment: eq, preconditions: pc,
      commercial: hasQuote ? "COMMERCIAL_HOLD" : "NONE",
      safety: hasHold ? "SAFETY_HOLD" : hasInspection ? "INSPECTION_DEPENDENT" : "NONE",
      customerCopy: copyDefect ? "DEFECT" : "OK",
      partnerCopy: F.slice(before).some((f) => f.rule === "HIDDEN_CUSTOMER_OBLIGATION" || (f.rule === "LEAK_ENUM_OR_INTERNAL_IN_COPY" && /partnerInstructions|handlingNote/.test(f.message))) ? "DEFECT" : "OK",
      bookabilityImpact: blocking.length ? "BLOCKING_CONFIRMATION" : "NONE",
      blocking, assignments: parsed.length, score: Math.max(0, score), scoreNotes: notes,
    });
  }
  const unused = catalogue.filter((i) => !used.has(i.code)).map((i) => i.code);
  for (const u of unused) warn("CATALOGUE_UNUSED", `${u} is in the catalogue but assigned to no service`, { item: u });
  const byKind: Record<string, number> = {};
  for (const i of catalogue) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return { version, findings: F, errors: F.filter((f) => f.severity === "ERROR").length, warnings: F.filter((f) => f.severity === "WARN").length, readiness, catalogue: { total: catalogue.length, byKind, unused }, assignments: assignmentsTotal };
}
