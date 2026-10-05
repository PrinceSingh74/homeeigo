/**
 * Operator wording for the reasons matching refuses a professional (backend MATCHING_GATE_ORDER,
 * lib/matching-gates.ts + lib/provider-capability.ts). ONE map, used by the booking's matching
 * diagnostics and by the partner's service readiness, so an operator reads the same words in both.
 *
 * An unknown code (a newer backend) is shown as readable text rather than hidden.
 */

const REASON_LABELS: Record<string, string> = {
  PROVENANCE_INVALID: "Different customer population",
  BUSINESS_NOT_AUTHORIZED: "Not authorised for this business",
  SERVICE_CAPABILITY_MISSING: "Service not granted",
  SKILL_MISSING: "Skill missing",
  CERTIFICATION_MISSING: "Certification missing",
  CERTIFICATION_EXPIRED: "Certification not valid",
  CERTIFICATION_UNVERIFIED: "Certification not verified",
  EQUIPMENT_MISSING: "Equipment missing",
  INSURANCE_INVALID: "Insurance not valid",
  LANGUAGE_MISMATCH: "Language not spoken",
  KYC_UNVERIFIED: "Identity not verified",
  BACKGROUND_CHECK_NOT_CLEARED: "Background check not cleared",
  EXPERIENCE_INSUFFICIENT: "Not enough experience",
  TRAINING_INCOMPLETE: "Training not completed",
  PROVIDER_NOT_AVAILABLE: "Not available",
  LOCATION_GATE_FAILED: "Outside service area",
  PRESENCE_STALE: "Location or presence out of date",
  CAPACITY_EXCEEDED: "At capacity",
};

const readable = (code: string) => {
  const s = code.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The short label of a rejection reason code. */
export function matchingReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? readable(code);
}

/** "EXPIRED|REVOKED" → "expired, revoked"; "NOT_YET_EFFECTIVE" → "not yet effective". */
const states = (s: string) =>
  s
    .split("|")
    .filter(Boolean)
    .map((x) => x.replace(/_/g, " ").toLowerCase())
    .join(", ");

const years = (n: string) => `${n} ${n === "1" ? "year" : "years"}`;

/** `type:STATE|STATE` → [type, "state, state"]; no colon → [detail, ""]. */
function typeAndStates(detail: string): [string, string] {
  const i = detail.indexOf(":");
  return i < 0 ? [detail, ""] : [detail.slice(0, i), states(detail.slice(i + 1))];
}

/**
 * One unmet requirement, naming the exact thing: "Certification missing: gas-safety",
 * "Background check: pending", "Experience 1 year, service needs 3". `detail` is the backend's
 * machine detail for that code; `title` is the academy module title when it is published.
 */
export function matchingGapLabel(gap: { code: string; detail?: string | null; title?: string | null }): string {
  const label = matchingReasonLabel(gap.code);
  const detail = (gap.detail ?? "").trim();
  switch (gap.code) {
    case "KYC_UNVERIFIED":
      return label;
    case "BACKGROUND_CHECK_NOT_CLEARED":
      return detail && detail !== "UNKNOWN" ? `Background check: ${states(detail)}` : "Background check: no result on file";
    case "EXPERIENCE_INSUFFICIENT": {
      const [have, need] = detail.split("<");
      return have && need ? `Experience ${years(have)}, service needs ${need}` : label;
    }
    case "TRAINING_INCOMPLETE":
      return `${label}: ${gap.title?.trim() || detail || "required module"}`;
    case "CERTIFICATION_EXPIRED":
    case "INSURANCE_INVALID": {
      const [type, state] = typeAndStates(detail);
      if (!type) return label;
      if (gap.code === "INSURANCE_INVALID" && state === "missing") return `Insurance missing: ${type}`;
      return state ? `${label}: ${type} (${state})` : `${label}: ${type}`;
    }
    case "LANGUAGE_MISMATCH":
      return detail ? `${label}: ${detail.toUpperCase()}` : label;
    default:
      return detail ? `${label}: ${detail.replace(/_/g, " ")}` : label;
  }
}
