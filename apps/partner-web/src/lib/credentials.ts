/**
 * Partner credentials ("My credentials") — the pure rules behind the page.
 *
 * Server contract (apps/backend provider-capability service, mirrored by hand):
 *   - a partner only DECLARES; status is set by the server (DECLARED) and changed by an admin;
 *   - certification / equipment / insurance types are free-form CODES matching
 *     /^[a-z0-9]+(-[a-z0-9]+)*$/ (there is no catalogue for them — only skills have one);
 *   - language codes are ISO 639-1 (two lowercase letters);
 *   - `requirementCatalogue` lists the certification / equipment / insurance codes that operational
 *     services require — the codes worth picking, since eligibility matches on the exact code;
 *   - withdraw (DELETE): DECLARED or REJECTED rows (a claim never accepted is the partner's to
 *     take back); languages: rows the partner created (source SELF);
 *   - edit (PATCH): certifications / insurance while DECLARED or REJECTED (goes back to DECLARED);
 *   - skills / equipment / languages change by declaring the same key again; on a VERIFIED equipment
 *     row only `operational` may change;
 *   - anything else answers 409 CAPABILITY_LOCKED.
 *
 * The page uses these to decide what to OFFER; the server decides again on every request.
 */
import type { CapabilityKind, CapabilityStatus, LanguageProficiency, RequirementCatalogue, SkillLevel } from "@/types/partner";

export const CAPABILITY_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "First Aid (Level 2)" → "first-aid-level-2". Empty when nothing usable remains. */
export function toCapabilityCode(name: string): string {
  const code = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return CAPABILITY_CODE.test(code) ? code : "";
}

/** "first-aid-level-2" → "First aid level 2" — a readable form of a stored code, nothing more. */
export function humanizeCode(code: string): string {
  const words = code.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

export const SKILL_LEVELS: readonly SkillLevel[] = ["BASIC", "SKILLED", "EXPERT"];
export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = { BASIC: "Basic", SKILLED: "Skilled", EXPERT: "Expert" };

export const LANGUAGE_PROFICIENCIES: readonly LanguageProficiency[] = ["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"];
export const PROFICIENCY_LABEL: Record<LanguageProficiency, string> = {
  BASIC: "Basic",
  CONVERSATIONAL: "Conversational",
  FLUENT: "Fluent",
  NATIVE: "Native",
};

/** ISO 639-1 codes offered in the picker. A stored code outside this list is shown as the code. */
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

export function languageName(code: string): string {
  return LANGUAGE_OPTIONS.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export type StatusTone = "pending" | "ok" | "bad";
export const STATUS_META: Record<CapabilityStatus, { label: string; tone: StatusTone; explain: string }> = {
  DECLARED: { label: "Awaiting review", tone: "pending", explain: "You declared this. It counts towards job eligibility once our team verifies it." },
  VERIFIED: { label: "Verified", tone: "ok", explain: "Verified by our team." },
  REJECTED: { label: "Rejected", tone: "bad", explain: "Our team could not verify this. Correct the details and it goes back for review, or remove it." },
  REVOKED: { label: "Revoked", tone: "bad", explain: "This was withdrawn by our team and no longer counts." },
};

type RowFacts = { status?: CapabilityStatus; source?: string };

/** Languages have no status: an admin-set row is the admin's record. */
export function isLocked(kind: CapabilityKind, row: RowFacts): boolean {
  if (kind === "languages") return row.source === "ADMIN";
  return row.status === "VERIFIED" || row.status === "REVOKED";
}

/** May the page offer "Remove"? */
export function canWithdraw(kind: CapabilityKind, row: RowFacts): boolean {
  if (kind === "languages") return row.source === "SELF";
  return row.status === "DECLARED" || row.status === "REJECTED";
}

/** The kinds whose type is a free-form code and therefore have a requirement catalogue. */
export type CataloguedKind = "certifications" | "equipment" | "insurance";

/**
 * The codes services require for one kind, as the server sent them. `null` when the server did not
 * send a catalogue at all (an older backend) — that is "unknown", which is not the same as "none".
 */
export function requirementCodes(catalogue: RequirementCatalogue | null | undefined, kind: CataloguedKind): string[] | null {
  const list = catalogue?.[kind];
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && CAPABILITY_CODE.test(c)) : null;
}

/** Whether a row's code is one a service currently requires. `null` = the catalogue is unknown. */
export function isRequiredByServices(catalogue: RequirementCatalogue | null | undefined, kind: CataloguedKind, code: string): boolean | null {
  const codes = requirementCodes(catalogue, kind);
  return codes === null ? null : codes.includes(code);
}

/**
 * What the add form's picker offers: catalogue codes not already excluded, with a readable label.
 * Empty means "show no picker" — the form falls back to free entry.
 */
export function requirementOptions(
  catalogue: RequirementCatalogue | null | undefined,
  kind: CataloguedKind,
  exclude: Iterable<string> = [],
): Array<{ code: string; label: string }> {
  const skip = new Set(exclude);
  return (requirementCodes(catalogue, kind) ?? [])
    .filter((code) => !skip.has(code))
    .map((code) => ({ code, label: humanizeCode(code) }));
}

/** May the page offer to change the row's facts (PATCH, or declaring the same key again)? */
export function canEdit(kind: CapabilityKind, row: RowFacts): boolean {
  if (kind === "languages") return row.source === "SELF";
  return row.status === "DECLARED" || row.status === "REJECTED";
}

/** A verified item of equipment can still be reported broken / repaired — the one unlocked fact. */
export function canToggleOperational(row: RowFacts): boolean {
  return row.status !== "REVOKED";
}

export type ExpiryHint = { label: string; tone: StatusTone };

/**
 * The expiry line for a row, from the SERVER's verdict (`validity`, `nearExpiry` — computed on its
 * clock) and the date it sent. Null when the row has no date and nothing to warn about.
 */
export function expiryHint(row: { validity: string; nearExpiry?: boolean; expiresAt?: string | null }, noun = "Expires"): ExpiryHint | null {
  const date = row.expiresAt ? formatDay(row.expiresAt) : null;
  if (row.validity === "EXPIRED") return { label: date ? `Expired on ${date}` : "Expired", tone: "bad" };
  if (row.validity === "INSPECTION_OVERDUE") return { label: date ? `Inspection was due on ${date}` : "Inspection overdue", tone: "bad" };
  if (row.nearExpiry) return { label: date ? `${noun} soon — ${date}` : `${noun} soon`, tone: "pending" };
  if (row.validity === "NOT_YET_EFFECTIVE") return { label: date ? `Not in effect yet · expires ${date}` : "Not in effect yet", tone: "pending" };
  return date ? { label: `${noun} ${date}`, tone: "ok" } : null;
}

/** Calendar day of a server timestamp, in UTC so a date typed as 2027-01-31 reads back as 31 Jan 2027. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A server timestamp as the value of an `<input type="date">`. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const ERROR_TEXT: Record<string, string> = {
  CAPABILITY_LOCKED: "This credential is locked because our team has already verified or revoked it. Add a new one instead, or contact support to change it.",
  NOT_DEPLOYED: "Credentials are not available on this server yet. Please try again later.",
  NOT_FOUND: "That credential no longer exists — the list has been refreshed.",
  SKILL_NOT_FOUND: "That skill is no longer in the catalogue. Choose another one.",
  SKILL_INACTIVE: "That skill is no longer offered. Choose another one.",
  INVALID_CODE: "Use letters and numbers for the name (for example: First aid level 2).",
  DOCUMENT_NOT_FOUND: "The attached document could not be found on your account.",
  ACTION_NOT_APPLICABLE: "That change is not available for this kind of credential.",
  PROVIDER_NOT_FOUND: "Your partner profile could not be found. Sign in again and retry.",
};

/**
 * What to tell the partner when a capability request is refused. The server puts its `detail`
 * (e.g. "expiresAt must be after issuedAt") or the bare code in `error`, so the code is mapped here
 * and a readable detail is kept for INVALID_INPUT.
 */
export function capabilityErrorMessage(error: unknown, fallback = "Could not save that. Please try again."): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";
  if (typeof code === "string") {
    if (code === "INVALID_INPUT") {
      if (/expiresAt must be after issuedAt/.test(message)) return "The expiry date must be after the issue date.";
      if (/expiresAt must be after effectiveFrom/.test(message)) return "The expiry date must be after the start date.";
      if (/expiresAt is required/.test(message)) return "Enter the date the policy expires.";
      if (message === "date") return "One of the dates is not valid.";
      return "Some of the details are not valid. Check them and try again.";
    }
    if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  }
  return message && !/^[A-Z_]+$/.test(message) ? message : fallback;
}
