/**
 * Render the FINAL Phase 06 content as the immutable review document (markdown on stdout).
 * Generated from scripts/data/phase-06-requirement-content-final.ts + the content engine report, so
 * the document, the validation and what apply-requirement-proposal.ts writes can never drift apart.
 *
 *   bun run scripts/render-requirement-content-final.ts > docs/service-domain/phase-06-requirement-content-final.md
 */
import { requirementAssignmentSchema, customerRequirementsView, resolveServiceRequirements, buildRequirementsSnapshot, partnerRequirementsFromSnapshot, blockingRequirementCodes, type RequirementItemInfo } from "../src/lib/service-requirements";
import { ASSUMPTIONS, CATALOGUE, CONTENT, CONTENT_VERSION, HOLDS, type ContentAssignment } from "./data/phase-06-requirement-content-final";
import { validateContent } from "./lib/requirement-content-validator";
import { contentHash } from "./lib/requirement-content-apply-plan";

const META: Record<string, { category: string; subcategory: string }> = {
  "fasade-cleaning": { category: "apartments", subcategory: "specialized-care" }, "salon-at-home": { category: "beauty", subcategory: "beauty" },
  "after-party-express-clean": { category: "cleaning", subcategory: "event-occasion" }, "pre-party-express-clean": { category: "cleaning", subcategory: "event-occasion" },
  "balcony-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "bathroom-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "carpet-shampooing": { category: "cleaning", subcategory: "home-cleaning" },
  "deep-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "fan-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "fridge-cleaning": { category: "cleaning", subcategory: "home-cleaning" },
  "kitchen-cabinet-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "kitchen-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "mattress-sanitization": { category: "cleaning", subcategory: "home-cleaning" },
  "sofa-deep-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "wardrobe-cleaning": { category: "cleaning", subcategory: "home-cleaning" }, "window-cleaning": { category: "cleaning", subcategory: "home-cleaning" },
  "car-surface-cleaning": { category: "cleaning", subcategory: "vehicle-care" }, "dusting-wiping": { category: "cleaning", subcategory: "home-help" }, "hourly-bookings": { category: "cleaning", subcategory: "home-help" },
  "kitchen-prep": { category: "cleaning", subcategory: "home-help" }, "packing-unpacking": { category: "cleaning", subcategory: "home-help" }, "sweeping-mopping": { category: "cleaning", subcategory: "home-help" }, "utensil-washing": { category: "cleaning", subcategory: "home-help" },
  "ironing-folding": { category: "cleaning", subcategory: "laundry-fabric" }, laundry: { category: "cleaning", subcategory: "laundry-fabric" }, "pest-control": { category: "cleaning", subcategory: "specialized-care" },
  "home-painting": { category: "home", subcategory: "home-maintenance" }, "plant-care": { category: "home", subcategory: "specialized-care" },
  "ac-service": { category: "repair", subcategory: "appliance-care" }, electrician: { category: "repair", subcategory: "home-maintenance" }, plumbing: { category: "repair", subcategory: "home-maintenance" },
};
const items: Record<string, RequirementItemInfo> = Object.fromEntries(CATALOGUE.map((i) => [i.code, { code: i.code, kind: i.kind, name: i.name, customerLabel: i.customerLabel, description: i.description, isActive: true }]));
const byCode = new Map(CATALOGUE.map((i) => [i.code, i]));
const report = validateContent({ version: CONTENT_VERSION, catalogue: CATALOGUE, content: CONTENT });
const hash = contentHash({ version: CONTENT_VERSION, catalogue: CATALOGUE, content: CONTENT });
const ENF: Record<string, string> = { INFORMATIONAL: "informational", WARNING: "preparation advice", REQUIRED_BEFORE_ARRIVAL: "checked on arrival", REQUIRED_AT_START: "checked at start", REQUIRED_BEFORE_BOOKING: "**must confirm to book**" };
const VER: Record<string, string> = { NONE: "—", PARTNER_CHECK: "professional checks", CUSTOMER_ATTESTATION: "customer confirms" };
const CHG: Record<string, string> = { INCLUDED: "included", SEPARATE_QUOTE: "**separate quote** (hold)", CHARGEABLE: "chargeable", NOT_APPLICABLE: "—" };
const who = (a: ContentAssignment) => (a.responsibility === "PROFESSIONAL" ? "professional" : a.responsibility === "CUSTOMER" ? "customer" : a.responsibility.toLowerCase());
const proc = (a: ContentAssignment) => a.procurement?.toLowerCase() ?? (a.responsibility === "PROFESSIONAL" ? "professional" : a.responsibility === "CUSTOMER" ? "customer" : "—");
const cond = (a: ContentAssignment) => (a.when ? JSON.stringify(a.when) : a.optional ? "optional" : "always");
const esc = (s?: string | null) => (s ?? "—").replace(/\|/g, "\\|");
const out: string[] = [];
const H = (t: string) => { out.push(""); out.push(t); out.push(""); };

H(`# Phase 06 — requirement content FINAL ${CONTENT_VERSION}`);
out.push("**v2 changes (2026-09-22):** facade-cleaning no longer shows access equipment as brought and included (unsupported equipment + price promise); its equipment is NOT_CONFIGURED under the safety hold. Assumptions A1–A3 promoted from SYSTEM_INFERRED to OWNER_APPROVED under the owner's Phase 06 content authorization (assumption ids kept). v1 (hash c19f8ab1…) is frozen in `scripts/data/phase-06-requirement-content-final.v1.json`.");
out.push("");
out.push(`Content hash \`${hash}\` · generated by \`scripts/render-requirement-content-final.ts\` from \`scripts/data/phase-06-requirement-content-final.ts\`. The previous proposal (\`phase-06-requirement-content-proposal.md\`) is kept as history.`);

H("## A. Executive summary");
const st = report.readiness.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
out.push(`31/31 live customer services carry finalised, structured requirement content: ${report.catalogue.total} shared catalogue items (${report.catalogue.byKind.MATERIAL} materials · ${report.catalogue.byKind.EQUIPMENT} equipment · ${report.catalogue.byKind.CUSTOMER_PRECONDITION} preconditions), ${report.assignments} assignments. Content engine: ${report.errors} errors, ${report.warnings} warnings. Readiness: ${Object.entries(st).map(([k, v]) => `${v} ${k}`).join(" · ")}. Exactly one booking-blocking confirmation exists (pest-control). Nothing asserts a quantity, brand, chemical specification, certification, supplier, price or medical requirement.`);

H("## B. Design principles");
out.push([
  "- Structured data is the truth; every customer or partner sentence is a projection of a field the reader can point to.",
  "- Zero-blocking bias: a booking blocks only when the customer's answer changes the safety outcome. Everything else is advice, or verified by the professional on arrival or at start.",
  "- Service-justified only: no generic 'water may be required'; a utility appears only where that service uses it.",
  "- One catalogue, no near-duplicates (stemmed similarity check); genuinely different materials stay separate (descaler ≠ degreaser ≠ upholstery shampoo).",
  "- Not configured ≠ no special requirement: every kind on every service is either configured or explicitly declared.",
  "- Uncertainty is converted, never hidden: inspection-dependent, separately quoted (with a COMMERCIAL_HOLD), safety hold, or an owner-overridable assumption tagged on the line.",
  "- Requirements never price anything; Phase 05 stays authoritative.",
].join("\n"));

H("## C. Requirement ontology");
out.push("| Question | Field | Values |\n|---|---|---|\n| What | `itemCode` → catalogue item (`kind`) | MATERIAL · EQUIPMENT · CUSTOMER_PRECONDITION |\n| Who provides | `responsibility` | CUSTOMER · PROFESSIONAL · PLATFORM · SHARED |\n| Who procures if missing | `procurement` | CUSTOMER · PROFESSIONAL · PLATFORM (defaults to the provider) |\n| Is it included / who pays | `charge` | INCLUDED · SEPARATE_QUOTE · CHARGEABLE (needs an add-on) · NOT_APPLICABLE (customer-provided) |\n| Optional | `optional` | true/false |\n| When needed / verified | `enforcement` + `verification` | INFORMATIONAL · WARNING · REQUIRED_BEFORE_ARRIVAL · REQUIRED_AT_START · REQUIRED_BEFORE_BOOKING × NONE · PARTNER_CHECK · CUSTOMER_ATTESTATION |\n| Condition | `when` | variantIds · addonIds · minQuantity (none live yet — no options exist) |\n| Customer sees | `customerNote` · `customerWarning` + server-phrased timing/charge text | projection only |\n| Partner sees | `partnerInstructions` · `handlingNote` (+ the customer note as 'customer was told') | projection only |\n| Admin sees | everything + `internalNote` = provenance + why + assumption | never projected |\n| Version / snapshot | service `version`; booking `service_config_snapshot.requirements` (`requirements.v1`) | immutable per booking |\n| Precondition class | catalogue description `Class: …` | ACCESS · UTILITY · SPACE · PARKING · BUILDING_PERMISSION · CUSTOMER_PREPARATION · ITEM_PREPARATION · SAFETY · OCCUPANCY · VEHICLE_ACCESS · TASK_INFORMATION |");

H("## D. Responsibility model");
out.push("Provides ≠ procures ≠ pays ≠ verifies. Examples in this content: spare parts — professional provides and procures, customer pays a separately confirmed amount (COMMERCIAL_HOLD until the in-app chain exists); household cleaning supplies — customer provides and owns, professional uses and checks on arrival; pest treatment preparation — customer prepares and confirms at booking, professional verifies on arrival.");

H("## E. Commercial model");
out.push("INCLUDED never creates a hidden charge. CHARGEABLE is not used: no live service has an add-on to price it. SEPARATE_QUOTE is used only for paint, refrigerant gas and spare parts, whose non-inclusion in a fixed base price is the material fact a customer must not discover on site; the copy promises confirmation of need and cost before use and states no amount. Because the app has no customer-facing quote → approval → payment chain (only admin maker-checker wallet adjustments exist), those four services are **COMMERCIAL_HOLD** (see S).");

H("## F. Safety handling");
out.push("No certification, method, chemical specification or medical guidance is asserted. Work at height has no defined method in HOMEEIGO: window-cleaning is limited to what is reachable from inside with the professional assessing the rest (READY_WITH_INSPECTION); facade-cleaning and exterior painting assert only society permission plus an on-site safety assessment (SAFETY_HOLD / INSPECTION_DEPENDENT). Pest-control defers re-entry advice to the product label via the professional. Allergy lines are disclosures, not medical requirements.");

H("## G. Shared catalogue");
for (const kind of ["MATERIAL", "EQUIPMENT", "CUSTOMER_PRECONDITION"] as const) {
  out.push(`**${kind === "CUSTOMER_PRECONDITION" ? "Customer preconditions" : kind[0] + kind.slice(1).toLowerCase() + "s"} (${CATALOGUE.filter((i) => i.kind === kind).length})**`);
  out.push("");
  out.push("| code | name | customer label | class / notes |");
  out.push("|---|---|---|---|");
  for (const i of CATALOGUE.filter((x) => x.kind === kind)) out.push(`| \`${i.code}\` | ${esc(i.name)} | ${esc(i.customerLabel)} | ${esc(i.description)} |`);
  out.push("");
}

H("## H–O. All 31 services: requirements, customer copy, partner copy, conditions, enforcement, verification, provenance");
for (const slug of Object.keys(CONTENT).sort()) {
  const svc = CONTENT[slug]!;
  const rd = report.readiness.find((r) => r.service === slug)!;
  const parsed = svc.assignments.map((a) => ({ ...requirementAssignmentSchema.parse((({ meta: _m, ...rest }) => rest)(a)), meta: a.meta })) as ContentAssignment[];
  const cfg = { requirements: parsed.map(({ meta: _m, ...a }) => a), requirementItems: items, variants: [], addons: [] } as never;
  const res = resolveServiceRequirements(cfg, { variantId: null, addonIds: [], quantity: 1 });
  out.push(`### ${slug}`);
  out.push("");
  out.push(`Category ${META[slug]?.category ?? "?"} · subcategory ${META[slug]?.subcategory ?? "?"} · content version ${CONTENT_VERSION} · **status ${rd.status}** (materials ${rd.materials} · equipment ${rd.equipment} · preconditions ${rd.preconditions}) · quality ${rd.score}${rd.scoreNotes.length ? ` (${rd.scoreNotes.join("; ")})` : ""}`);
  out.push("");
  out.push(`_${svc.rationale}_`);
  out.push("");
  for (const [k, why] of Object.entries(svc.noSpecial ?? {})) out.push(`- ${k}: **no special requirement** — ${why}`);
  for (const [k, why] of Object.entries(svc.unconfigured ?? {})) out.push(`- ${k}: **not configured (safety hold)** — ${why}`);
  const byKind = (k: string) => parsed.filter((a) => byCode.get(a.itemCode)?.kind === k);
  for (const [kind, title] of [["MATERIAL", "Materials"], ["EQUIPMENT", "Equipment"]] as const) {
    const list = byKind(kind); if (!list.length) continue;
    out.push(""); out.push(`**${title}**`); out.push("");
    out.push("| item | responsibility | procurement | charge | enforcement | condition | customer copy | partner instruction | provenance |");
    out.push("|---|---|---|---|---|---|---|---|---|");
    for (const a of list) out.push(`| ${esc(byCode.get(a.itemCode)!.name)} | ${who(a)} | ${proc(a)} | ${CHG[a.charge]} | ${ENF[a.enforcement]} | ${cond(a)} | ${esc(a.customerNote)} | ${esc([a.partnerInstructions, a.handlingNote].filter(Boolean).join(" ") || null)} | ${a.meta.provenance}${a.meta.assumption ? ` (${a.meta.assumption})` : ""} |`);
  }
  const pcs = byKind("CUSTOMER_PRECONDITION");
  if (pcs.length) {
    out.push(""); out.push("**Customer preconditions**"); out.push("");
    out.push("| requirement | class | enforcement | verification | condition | customer copy | partner instruction | provenance |");
    out.push("|---|---|---|---|---|---|---|---|");
    for (const a of pcs) out.push(`| ${esc(byCode.get(a.itemCode)!.name)} | ${byCode.get(a.itemCode)!.preconditionClass} | ${ENF[a.enforcement]} | ${VER[a.verification]} | ${cond(a)} | ${esc([a.customerNote, a.customerWarning ? "⚠ " + a.customerWarning : null].filter(Boolean).join(" "))} | ${esc(a.partnerInstructions)} | ${a.meta.provenance} |`);
  }
  if (res.ok) {
    const v = customerRequirementsView(res.items);
    const snap = buildRequirementsSnapshot(res.items, 0, blockingRequirementCodes(res.items));
    const pb = partnerRequirementsFromSnapshot({ requirements: snap })!;
    const sec = (title: string, arr: { label: string; quantity?: string | null; note?: string | null; chargeText?: string | null; timingText?: string | null }[]) => (arr.length ? `\n**${title}**\n${arr.map((x) => `- ${x.label}${[x.chargeText, x.timingText].filter(Boolean).length ? ` · ${[x.chargeText, x.timingText].filter(Boolean).join(" · ")}` : ""}${x.note ? `\n  ${x.note}` : ""}`).join("\n")}` : "");
    out.push(""); out.push("**Customer sees — What you need before we arrive**");
    out.push([sec("Before booking", v.beforeBooking), sec("Have this ready", v.beforeArrival), sec("You provide", v.youProvide), sec("Shared", v.shared), sec("We bring", v.weBring), sec("Optional", v.optional)].filter(Boolean).join("\n"));
    const psec = (title: string, arr: { label: string; instructions?: string | null; check?: string }[]) => (arr.length ? `\n**${title}**\n${arr.map((x) => `- ${x.label}${x.check ? ` · ${x.check}` : ""}${x.instructions ? `\n  ${x.instructions}` : ""}`).join("\n")}` : "");
    out.push(""); out.push("**Partner sees — Job preparation** (from the booking snapshot)");
    out.push([psec("Bring — materials", pb.bringMaterials), psec("Bring — equipment", pb.bringEquipment), psec("Customer provides", pb.customerProvides), psec("Customer preconditions", pb.preconditions)].filter(Boolean).join("\n"));
  }
  out.push("");
}

H("## P. Service readiness matrix");
out.push("| service | requirement | materials | equipment | preconditions | commercial | safety | customer copy | partner copy | bookability | status | score |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of [...report.readiness].sort((a, b) => a.service.localeCompare(b.service))) out.push(`| ${r.service} | ${r.requirement} | ${r.materials} | ${r.equipment} | ${r.preconditions} | ${r.commercial} | ${r.safety} | ${r.customerCopy} | ${r.partnerCopy} | ${r.bookabilityImpact}${r.blocking.length ? ` (${r.blocking.join(", ")})` : ""} | **${r.status}** | ${r.score} |`);

H("## Q. Owner / business assumptions (overridable in admin tab 09b)");
out.push("| id | assumption |\n|---|---|");
for (const [k, v] of Object.entries(ASSUMPTIONS)) out.push(`| ${k} | ${v} |`);

H("## R. Safety holds");
for (const h of HOLDS.filter((x) => x.kind === "SAFETY_HOLD")) out.push(`- **${h.services.join(", ")}** — ${h.what} Unblocked by: ${h.unblockedBy}`);
H("## S. Commercial holds");
for (const h of HOLDS.filter((x) => x.kind === "COMMERCIAL_HOLD")) out.push(`- **${h.services.join(", ")}** — ${h.what} Unblocked by: ${h.unblockedBy}`);

H("## T. Final validation evidence");
out.push(`- Content engine: ${report.errors} errors, ${report.warnings} warnings over ${report.assignments} assignments (rules: schema, kind/responsibility/charge semantics, copy↔data, enum/internal leakage, hidden customer obligation, safety verification, commercial hold, duplicate item, gate conflict, resolver, coverage, kind decided, provenance).`);
out.push(`- Content hash: \`${hash}\` — every live write is tied to it (\`--expect-hash\`).`);
out.push("- Runtime, browser, regression, defect-reintroduction and live-application evidence: `phase-06-requirement-content-final-certification.md`.");
console.log(out.join("\n"));
