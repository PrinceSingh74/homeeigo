/**
 * Phase 11 — "My credentials" (partner capability self-service), the pure half.
 *
 * Mirrors the rules of backend `services/provider-capability.service.ts`:
 *  - a partner only DECLARES; an administrator verifies. Status is the server's, never set here;
 *  - a row can be withdrawn only while it was never accepted (DECLARED or REJECTED; a language only
 *    while `source` is SELF);
 *  - certification / insurance facts can be edited while DECLARED or REJECTED (the edit sends the row
 *    back to DECLARED); skills, equipment and languages are keyed — declaring one again updates it;
 *  - a VERIFIED or REVOKED row is locked (409 `CAPABILITY_LOCKED`). The one exception is the working
 *    state of verified equipment, which the partner may still report.
 *
 * These mirrors only decide which buttons to show; the server stays the authority and its refusal is
 * always surfaced. No react-native imports: this file runs under `node --test`.
 */

export type CapabilityKind = "skills" | "certifications" | "equipment" | "insurance" | "languages";
export type CapabilityStatus = "DECLARED" | "VERIFIED" | "REJECTED" | "REVOKED";

export const CAPABILITY_LOCKED = "CAPABILITY_LOCKED";
export const CAPABILITY_NOT_DEPLOYED = "NOT_DEPLOYED";

/** Backend `lib/provider-capability.ts` — closed value sets, same order. */
export const SKILL_LEVELS = ["BASIC", "SKILLED", "EXPERT"] as const;
export const LANGUAGE_PROFICIENCIES = ["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"] as const;
/** Backend `services/provider-capability.service.ts` OWNERSHIP / OPERATIONAL. */
export const EQUIPMENT_OWNERSHIP = ["OWNED", "RENTED", "EMPLOYER"] as const;
export const EQUIPMENT_OPERATIONAL = ["OPERATIONAL", "OUT_OF_SERVICE"] as const;

export const CAPABILITY_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LANGUAGE_CODE = /^[a-z]{2}$/;

/**
 * Certification, equipment and insurance types are stored as short codes (`^[a-z0-9]+(-[a-z0-9]+)*$`,
 * at most 80 characters). The partner types a name; this is the code it is saved under. Returns ""
 * when nothing usable was typed.
 */
export function toCapabilityCode(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** `electrical-licence` → `Electrical licence`. Display only; the code is what the server holds. */
export function humanizeCode(code: string): string {
  const words = code.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

/** `OUT_OF_SERVICE` → `Out of service`. */
export function humanizeEnum(value: string): string {
  const words = value.replace(/_+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/** State = glyph + word, never colour alone. */
const STATUS_BADGE: Record<CapabilityStatus, { glyph: string; label: string }> = {
  DECLARED: { glyph: "○", label: "Awaiting review" },
  VERIFIED: { glyph: "✓", label: "Verified" },
  REJECTED: { glyph: "✕", label: "Rejected" },
  REVOKED: { glyph: "⊘", label: "Revoked" },
};

export function capabilityStatusBadge(status: string): { glyph: string; label: string } {
  return STATUS_BADGE[status as CapabilityStatus] ?? { glyph: "•", label: status };
}

/** Languages have no review lifecycle: active or not, and who set it. */
export function languageBadge(row: { active: boolean; source: string }): { glyph: string; label: string } {
  if (!row.active) return { glyph: "⊘", label: "Inactive" };
  return row.source === "ADMIN" ? { glyph: "✓", label: "Recorded by the Homeeigo team" } : { glyph: "○", label: "Declared by you" };
}

export type DateInput = { ok: true; value: string | null } | { ok: false };

/**
 * A date typed as `YYYY-MM-DD`. Empty is "not given" (`value: null`); anything else must be a real
 * calendar date — `2026-02-30` is refused here rather than silently rolled over by `new Date`.
 */
export function parseDateInput(text: string): DateInput {
  const s = text.trim();
  if (!s) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { ok: false };
  return { ok: true, value: s };
}

/** An ISO timestamp from the server as the `YYYY-MM-DD` an edit form starts from. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export type ExpiryHint = { tone: "expired" | "soon" | "ok"; glyph: string; text: string };

/**
 * The expiry line of a row. The server's `validity` and `nearExpiry` (≤30 days ahead) are used as
 * sent; the date comparison is only the fallback for a row whose validity names another state (an
 * unverified certificate that has also lapsed still reads as expired).
 */
export function expiryHint(
  row: { expiresAt?: string | null; validity?: string | null; nearExpiry?: boolean | null },
  now: Date,
  formatDate: (iso: string) => string,
): ExpiryHint | null {
  if (!row.expiresAt) return null;
  const at = new Date(row.expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const when = formatDate(row.expiresAt);
  if (row.validity === "EXPIRED" || at <= now.getTime()) return { tone: "expired", glyph: "✕", text: `Expired on ${when}` };
  if (row.nearExpiry === true) {
    const days = Math.max(1, Math.ceil((at - now.getTime()) / 86_400_000));
    return { tone: "soon", glyph: "⚠", text: `Expires soon — ${when} (${days} day${days === 1 ? "" : "s"} left)` };
  }
  return { tone: "ok", glyph: "", text: `Valid until ${when}` };
}

export type RowPermissions = {
  /** DELETE /:kind/:rowId would be accepted. */
  canRemove: boolean;
  /** PATCH /:kind/:rowId would be accepted (certifications and insurance only). */
  canEdit: boolean;
  /** Equipment only: the working state can be reported by declaring it again. */
  canReportOperational: boolean;
  /** True when the row cannot be changed by the partner at all (shown with a lock glyph). */
  locked: boolean;
  /** Why, or what the partner can do instead; null when the row is freely editable. */
  hint: string | null;
};

export function rowPermissions(
  kind: CapabilityKind,
  row: { status?: string | null; source?: string | null },
): RowPermissions {
  if (kind === "languages") {
    const own = row.source === "SELF";
    return {
      canRemove: own,
      canEdit: false,
      canReportOperational: false,
      locked: !own,
      hint: own ? null : "Recorded by the Homeeigo team — only they can change it.",
    };
  }
  const status = row.status;
  const editable = kind === "certifications" || kind === "insurance";
  if (status === "DECLARED") {
    return { canRemove: true, canEdit: editable, canReportOperational: kind === "equipment", locked: false, hint: null };
  }
  if (status === "REJECTED") {
    // A claim that was never accepted is still the partner's to withdraw (backend `partnerDelete`).
    return {
      canRemove: true,
      canEdit: editable,
      canReportOperational: false,
      locked: false,
      hint: editable
        ? "Not accepted. Edit the details to send it back for review, or remove it."
        : "Not accepted. Declare it again below with corrected details to send it back for review, or remove it.",
    };
  }
  if (status === "VERIFIED") {
    return {
      canRemove: false,
      canEdit: false,
      canReportOperational: kind === "equipment",
      locked: true,
      hint:
        kind === "equipment"
          ? "Verified — locked. You can still report whether it is working."
          : editable
            ? "Verified — locked. Add a new entry when it is renewed."
            : "Verified — locked.",
    };
  }
  return { canRemove: false, canEdit: false, canReportOperational: false, locked: true, hint: "Revoked — locked. Only the Homeeigo team can change it." };
}

/* ---- Requirement catalogue: the codes operational services actually ask for ----
 * `GET /api/providers/me/capabilities` → `requirementCatalogue.{certifications,equipment,insurance}`.
 * Picking from it gives the exact code a service requires, instead of a typed spelling that matches
 * nothing. Absent on an older backend; an empty list means there is nothing to pick from. */

export type RequirementCatalogueKind = "certifications" | "equipment" | "insurance";
export type RequirementCatalogue = Partial<Record<RequirementCatalogueKind, readonly string[] | null>> | null | undefined;

/** The picker's "none of these" entry — never sent to the server. */
export const OTHER_CHOICE = "__other__";

function catalogueCodes(catalogue: RequirementCatalogue, kind: RequirementCatalogueKind): string[] {
  const raw = catalogue?.[kind];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    // Only codes the declare route would accept are offered; anything else is dropped, not repaired.
    if (typeof c !== "string" || !CAPABILITY_CODE.test(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** The tappable choices for one kind, in the server's order: `first-aid` → "First aid". Empty = no picker. */
export function catalogueChoices(catalogue: RequirementCatalogue, kind: RequirementCatalogueKind): Array<{ code: string; label: string }> {
  return catalogueCodes(catalogue, kind).map((code) => ({ code, label: humanizeCode(code) }));
}

/**
 * The type code an add form will send: the picked catalogue code as it is, or — for "Other…", or when
 * there is no catalogue to pick from — the typed name turned into a code. "" when nothing usable yet.
 */
export function resolveTypeCode(choices: ReadonlyArray<{ code: string }>, picked: string | null, typedName: string): string {
  if (choices.length === 0 || picked === OTHER_CHOICE) return toCapabilityCode(typedName);
  return picked && choices.some((c) => c.code === picked) ? picked : "";
}

export type RequirementMark = { required: boolean; glyph: string; label: string };

/**
 * Whether a row's code is one a service currently requires — from the catalogue alone. With no
 * catalogue for the kind (older backend, or nothing required) there is nothing to compare against,
 * so no mark is shown rather than a guess.
 */
export function requirementMark(catalogue: RequirementCatalogue, kind: RequirementCatalogueKind, code: string): RequirementMark | null {
  const codes = catalogueCodes(catalogue, kind);
  if (codes.length === 0) return null;
  return codes.includes(code)
    ? { required: true, glyph: "◆", label: "Required by a current service" }
    : { required: false, glyph: "◇", label: "Not required by any current service" };
}

/** What a refused capability request means to the partner. `message` is the server's `error` text. */
export function describeCapabilityError(code: string | null | undefined, message?: string | null): string {
  switch (code) {
    case CAPABILITY_LOCKED:
      return "This credential is locked — it has been verified or revoked, and only the Homeeigo team can change it.";
    case CAPABILITY_NOT_DEPLOYED:
      return "Credentials are not available yet.";
    case "SKILL_NOT_FOUND":
    case "SKILL_INACTIVE":
      return "That skill is no longer offered. Pick another from the list.";
    case "INVALID_CODE":
      return "Use letters and numbers for the type (a two-letter code for a language).";
    case "INVALID_INPUT":
      return message && message !== code ? `Check the details and try again (${message}).` : "Check the details and try again.";
    case "DOCUMENT_NOT_FOUND":
      return "That document is not one of your uploaded documents.";
    case "NOT_FOUND":
      return "This entry no longer exists. Pull the latest list and try again.";
    case "ACTION_NOT_APPLICABLE":
      return "This kind of credential cannot be edited — declare it again instead.";
    default:
      return message || "Something went wrong. Try again.";
  }
}
