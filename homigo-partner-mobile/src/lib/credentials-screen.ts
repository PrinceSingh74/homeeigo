/**
 * "My credentials" — the screen's own rules, pure half (the row rules are in `capabilities.ts`).
 *
 * What is decided here: the word and tone of a status pill, the sentence after a write (built from
 * what the server answered — `changed` and the stored row's `status` — because the capability routes
 * send no success sentence), how a failure reads (no connection apart from a refusal), the dated
 * form's checks, and the body that reports equipment as working or not.
 *
 * Backend read for these: `routes/provider-capabilities.ts` (bodies, `capabilityResponse`) and
 * `services/provider-capability.service.ts` (`declare*`, `partnerEdit`, `getProviderCapabilityProfile`).
 *
 * No react-native imports: this file runs under `node --test`.
 */
import type { ProviderCertificationView, ProviderEquipmentView, ProviderInsuranceView, ProviderLanguageView, ProviderSkillView } from "@/types/partner";
import {
  capabilityStatusBadge,
  describeCapabilityError,
  expiryHint,
  humanizeCode,
  humanizeEnum,
  languageBadge,
  parseDateInput,
  requirementMark,
  rowPermissions,
  type CapabilityKind,
  type ExpiryHint,
  type RequirementCatalogue,
  type RowPermissions,
} from "./capabilities.ts";
import { errorCode, errorSentence, isOfflineError, OFFLINE_SENTENCE } from "./error-sentence.ts";

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info";
export type PillView = { label: string; tone: PillTone };

const STATUS_TONE: Record<string, PillTone> = { DECLARED: "info", VERIFIED: "success", REJECTED: "danger", REVOKED: "danger" };

/** The status as a word in a pill. A status this build does not know is shown as sent, in plain case. */
export function statusPill(status: string): PillView {
  const tone = STATUS_TONE[status];
  return tone ? { label: capabilityStatusBadge(status).label, tone } : { label: humanizeEnum(status), tone: "neutral" };
}

export function languagePill(row: { active: boolean; source: string }): PillView {
  return { label: languageBadge(row).label, tone: row.active && row.source === "ADMIN" ? "success" : "neutral" };
}

/** ISO 639-1 codes offered as choices — the same list as partner web (`apps/partner-web/src/lib/credentials.ts`). */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "ta", name: "Tamil" },
  { code: "ur", name: "Urdu" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "as", name: "Assamese" },
];

/** The language's name where it is one of the offered ones; otherwise the stored code itself. */
export function languageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

/**
 * The sentence after a declare or an edit. A declare answers `{ row, changed }`; `changed: false`
 * means the server kept the row as it was, so nothing is claimed. An edit answers `{ row }` only.
 */
export function writeOutcome(what: string, res: { row?: { status?: unknown; [key: string]: unknown } | null; changed?: boolean }): string {
  if (res.changed === false) return `Nothing changed. ${what} is already on your profile with these details.`;
  const status = typeof res.row?.status === "string" ? res.row.status : null;
  return status ? `${what} saved. Status: ${statusPill(status).label}.` : `${what} saved.`;
}

export type Failure = { tone: "warning" | "danger"; message: string };

const BARE_CODE = /^[A-Z0-9_]+$/;

/**
 * A failed capability request. No HTTP answer is the offline sentence. A refusal is the server's
 * sentence — except that these routes answer with the bare code as their sentence
 * (`error: r.detail ?? r.error`), so a known code is put into words and a bare code is never shown.
 */
export function capabilityFailure(error: unknown): Failure {
  if (isOfflineError(error)) return { tone: "warning", message: OFFLINE_SENTENCE };
  const said = errorSentence(error, "");
  const message = describeCapabilityError(errorCode(error), said && !BARE_CODE.test(said.trim()) ? said : null);
  return { tone: "danger", message };
}

/**
 * The label of the profile's `summary.pendingReview`. The server counts DECLARED credentials AND
 * REQUESTED services in that one figure, so when a service request is open the label says so.
 */
export function pendingReviewLabel(services: ReadonlyArray<{ status?: unknown }> | null | undefined): string {
  const requested = Array.isArray(services) && services.some((s) => s?.status === "REQUESTED");
  return requested ? "Awaiting review, with service requests" : "Awaiting review";
}

export type DatedFormInput = {
  /** Editing an existing row: its type is fixed and not asked for again. */
  editing: boolean;
  /** The type code the form would send ("" when none yet). */
  code: string;
  /** True when the type is typed rather than picked. */
  freeEntry: boolean;
  typeLabel: string;
  start: string;
  expires: string;
  /** Insurance: the server refuses a claim without an expiry date. */
  expiryRequired: boolean;
};
export type DatedFormCheck = { ok: true; start: string | null; expires: string | null } | { ok: false; field: "type" | "start" | "expires"; message: string };

const DATE_FORMAT = "Write the date as YYYY-MM-DD, for example 2027-03-31.";

/** The certification / insurance form's checks — the ones the server makes, made before the request. */
export function checkDatedForm(f: DatedFormInput): DatedFormCheck {
  if (!f.editing && !f.code) return { ok: false, field: "type", message: `${f.freeEntry ? "Enter" : "Choose"} the ${f.typeLabel.toLowerCase()}.` };
  const start = parseDateInput(f.start);
  if (!start.ok) return { ok: false, field: "start", message: DATE_FORMAT };
  const expires = parseDateInput(f.expires);
  if (!expires.ok) return { ok: false, field: "expires", message: DATE_FORMAT };
  if (f.expiryRequired && !expires.value) return { ok: false, field: "expires", message: "The expiry date is required." };
  if (start.value && expires.value && expires.value <= start.value) return { ok: false, field: "expires", message: "The expiry date must be after the start date." };
  return { ok: true, start: start.value, expires: expires.value };
}

/* ---- One row of the list, and what its detail sheet lists ----
 * Only fields the server sent are listed; a field it left null is left out, not filled in. */

export type Fact = { label: string; value: string };
export type CredentialRowView = {
  kind: CapabilityKind;
  id: number;
  title: string;
  /** The review status (for a language: who recorded it). */
  pill: PillView;
  /** A second word when something about dates needs the partner's eye: expired, expiring, overdue. */
  attention: PillView | null;
  subtitle: string | null;
  facts: Fact[];
  /** Plain sentences under the facts: the requirement mark, why the row is locked, a revocation reason. */
  notes: string[];
  perms: RowPermissions;
};

type DateFormatter = (iso: string) => string;

function expiryAttention(hint: ExpiryHint | null): PillView | null {
  if (!hint) return null;
  if (hint.tone === "expired") return { label: "Expired", tone: "danger" };
  if (hint.tone === "soon") return { label: "Expires soon", tone: "warning" };
  return null;
}

const compact = (notes: Array<string | null | undefined | false>): string[] => notes.filter((n): n is string => typeof n === "string" && n.length > 0);

export function skillRowView(r: ProviderSkillView, now: Date, formatDate: DateFormatter): CredentialRowView {
  const perms = rowPermissions("skills", r);
  const expiry = expiryHint(r, now, formatDate);
  const level = r.level ? humanizeEnum(r.level) : null;
  return {
    kind: "skills",
    id: r.id,
    title: r.skillName || humanizeCode(r.skillCode),
    pill: statusPill(r.status),
    attention: expiryAttention(expiry),
    subtitle: `${r.skillCategory} · ${level ? `Level: ${level}` : "Level not stated"}`,
    facts: [
      { label: "Category", value: r.skillCategory },
      { label: "Your level", value: level ?? "Not stated" },
      ...(r.verifiedAt ? [{ label: "Verified on", value: formatDate(r.verifiedAt) }] : []),
      ...(r.expiresAt ? [{ label: "Expires", value: formatDate(r.expiresAt) }] : []),
    ],
    notes: compact([!r.skillActive && "This skill is no longer offered in the catalogue.", expiry && expiry.tone !== "ok" ? expiry.text : null, perms.hint]),
    perms,
  };
}

/** The words of the two dated kinds: what the organisation, the reference and the start date are called. */
export const DATED_WORDS = {
  certifications: { noun: "Certification", typeLabel: "Certificate or licence", typePlaceholder: "For example: Electrical licence", orgLabel: "Issued by", refLabel: "Reference number", startLabel: "Issued on", expiryRequired: false },
  insurance: { noun: "Insurance", typeLabel: "Type of cover", typePlaceholder: "For example: Public liability", orgLabel: "Insurer", refLabel: "Policy number", startLabel: "Effective from", expiryRequired: true },
} as const;

export function datedRowView(
  kind: "certifications" | "insurance",
  r: ProviderCertificationView | ProviderInsuranceView,
  catalogue: RequirementCatalogue,
  now: Date,
  formatDate: DateFormatter,
): CredentialRowView {
  const words = DATED_WORDS[kind];
  const type = "certificationType" in r ? r.certificationType : r.insuranceType;
  const org = "certificationType" in r ? r.issuer : r.insurer;
  const ref = "certificationType" in r ? r.referenceNumber : r.policyReference;
  const start = "certificationType" in r ? r.issuedAt : r.effectiveFrom;
  const perms = rowPermissions(kind, r);
  const expiry = expiryHint(r, now, formatDate);
  const mark = requirementMark(catalogue, kind, type);
  const live = r.status !== "REVOKED" && r.status !== "REJECTED";
  const attention = !live ? null : (expiryAttention(expiry) ?? (r.validity === "NOT_YET_EFFECTIVE" ? { label: "Not in effect yet", tone: "info" as const } : null));
  return {
    kind,
    id: r.id,
    title: humanizeCode(type),
    pill: statusPill(r.status),
    attention,
    subtitle: expiry?.text ?? org ?? null,
    facts: [
      ...(org ? [{ label: words.orgLabel, value: org }] : []),
      ...(ref ? [{ label: words.refLabel, value: ref }] : []),
      ...(start ? [{ label: words.startLabel, value: formatDate(start) }] : []),
      ...(r.expiresAt ? [{ label: "Expires", value: formatDate(r.expiresAt) }] : []),
      ...(r.documentId ? [{ label: "Supporting document", value: "Attached" }] : []),
      ...(r.verifiedAt ? [{ label: "Verified on", value: formatDate(r.verifiedAt) }] : []),
    ],
    notes: compact([mark?.label, r.status === "REVOKED" && r.revokedReason ? `Reason: ${r.revokedReason}` : null, perms.hint]),
    perms,
  };
}

export function equipmentRowView(r: ProviderEquipmentView, catalogue: RequirementCatalogue, formatDate: DateFormatter): CredentialRowView {
  const perms = rowPermissions("equipment", r);
  const condition = r.operational === "OPERATIONAL" ? "Working" : "Out of service";
  const mark = requirementMark(catalogue, "equipment", r.equipmentType);
  const live = r.status !== "REVOKED" && r.status !== "REJECTED";
  // For equipment the server's `nearExpiry` flags the inspection due date, not an expiry.
  const attention: PillView | null = !live || !r.inspectionDueAt ? null : r.validity === "INSPECTION_OVERDUE" ? { label: "Inspection overdue", tone: "danger" } : r.nearExpiry ? { label: "Inspection due soon", tone: "warning" } : null;
  return {
    kind: "equipment",
    id: r.id,
    title: humanizeCode(r.equipmentType),
    pill: statusPill(r.status),
    attention,
    subtitle: `${humanizeEnum(r.ownership)} · ${condition}`,
    facts: [
      { label: "Ownership", value: humanizeEnum(r.ownership) },
      { label: "Condition", value: condition },
      ...(r.inspectionDueAt ? [{ label: "Inspection due", value: formatDate(r.inspectionDueAt) }] : []),
      ...(r.note ? [{ label: "Note", value: r.note }] : []),
      ...(r.verifiedAt ? [{ label: "Verified on", value: formatDate(r.verifiedAt) }] : []),
    ],
    notes: compact([mark?.label, perms.hint]),
    perms,
  };
}

export function languageRowView(r: ProviderLanguageView): CredentialRowView {
  const perms = rowPermissions("languages", r);
  return {
    kind: "languages",
    id: r.id,
    title: languageLabel(r.languageCode),
    pill: languagePill(r),
    attention: null,
    subtitle: humanizeEnum(r.proficiency),
    facts: [
      { label: "Language code", value: r.languageCode.toUpperCase() },
      { label: "How well you speak it", value: humanizeEnum(r.proficiency) },
    ],
    notes: compact([perms.hint]),
    perms,
  };
}

type Ownership = "OWNED" | "RENTED" | "EMPLOYER";
type Operational = "OPERATIONAL" | "OUT_OF_SERVICE";

/**
 * Reporting the working state re-declares the same item with the other state. On a VERIFIED row the
 * server accepts only a change of `operational` — same ownership and NO `note` key (a note that
 * differs is 409 CAPABILITY_LOCKED); on a claim the stored note is resent so it is not cleared.
 */
export function equipmentReportBody(row: { equipmentType: string; ownership: Ownership; operational: Operational; status: string; note: string | null }): {
  equipmentType: string;
  ownership: Ownership;
  operational: Operational;
  note?: string | null;
} {
  return {
    equipmentType: row.equipmentType,
    ownership: row.ownership,
    operational: row.operational === "OPERATIONAL" ? "OUT_OF_SERVICE" : "OPERATIONAL",
    ...(row.status === "VERIFIED" ? {} : { note: row.note }),
  };
}
