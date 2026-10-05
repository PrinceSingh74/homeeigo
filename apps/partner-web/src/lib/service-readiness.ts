/**
 * Service readiness — why a professional who performs a service is not being offered its jobs.
 *
 * Server contract (apps/backend partner-service-skills.service `buildServiceSkillBoard`, mirrored by
 * hand): every card in the `performing` lane of `GET /api/providers/me/service-skills` carries
 * `readiness: { ready, missing: [{ code, detail, title? }] }`. `code` is a matching rejection reason
 * and `detail` identifies the thing:
 *
 *   SKILL_MISSING (skill code) · CERTIFICATION_MISSING (type) · CERTIFICATION_UNVERIFIED (type) ·
 *   CERTIFICATION_EXPIRED (`type:STATE|STATE`) · EQUIPMENT_MISSING (type) ·
 *   INSURANCE_INVALID (`type:STATE|…` or `type:MISSING`) · LANGUAGE_MISMATCH (2-letter code) ·
 *   KYC_UNVERIFIED · BACKGROUND_CHECK_NOT_CLEARED (NOT_DONE | PENDING | FAILED | UNKNOWN) ·
 *   EXPERIENCE_INSUFFICIENT (`have<need`) · TRAINING_INCOMPLETE (module slug, `title` when published)
 *
 * Everything here is pure. The wording is exact about state: a thing that is waiting on our team
 * says so and asks for nothing; a thing the professional must do names it once. A code this file
 * does not know renders a neutral sentence, never the raw code. `readiness` absent (older backend,
 * other lanes) means "unknown" — callers show no readiness UI at all, never "ready".
 */
import { humanizeCode, languageName } from "@/lib/credentials";
import type { ServiceReadiness, ServiceReadinessGap } from "@/types/partner";

export const READINESS_LINKS = {
  credentials: "/work-hq/credentials",
  academy: "/academy",
  verification: "/trust-compliance/verification",
  support: "/support",
} as const;

export type ReadinessStep = { href: string; label: string };

export type ReadinessLine = {
  /** One plain sentence the professional can act on (or wait on). */
  sentence: string;
  /** Where to go next, when the app has a place for it. Null = nothing to do here. */
  step: ReadinessStep | null;
  /** The professional has nothing to do but wait for a review. */
  waiting: boolean;
};

const addCredential: ReadinessStep = { href: READINESS_LINKS.credentials, label: "Open My Credentials" };
const viewCredential: ReadinessStep = { href: READINESS_LINKS.credentials, label: "View in My Credentials" };
const verification: ReadinessStep = { href: READINESS_LINKS.verification, label: "Check verification status" };
const support: ReadinessStep = { href: READINESS_LINKS.support, label: "Contact support" };

/** `type:STATE|STATE` → the type and its states (none when the detail is just a type). */
function splitDetail(detail: string): { type: string; states: string[] } {
  const at = detail.indexOf(":");
  if (at < 0) return { type: detail, states: [] };
  return { type: detail.slice(0, at), states: detail.slice(at + 1).split("|").filter(Boolean) };
}

const named = (code: string) => `"${humanizeCode(code)}"`;

export function describeReadinessGap(gap: ServiceReadinessGap): ReadinessLine {
  const detail = typeof gap.detail === "string" ? gap.detail : "";
  switch (gap.code) {
    case "SKILL_MISSING":
      return {
        sentence: `This service needs a verified ${named(detail)} skill. If it is already on your credentials it is awaiting review; otherwise add it.`,
        step: addCredential,
        waiting: false,
      };
    case "CERTIFICATION_MISSING":
      return { sentence: `This service needs a ${named(detail)} certificate, and none is on your credentials yet.`, step: addCredential, waiting: false };
    case "CERTIFICATION_UNVERIFIED":
      return { sentence: `Your ${named(detail)} certificate is awaiting review by our team. There is nothing more you need to do.`, step: viewCredential, waiting: true };
    case "CERTIFICATION_EXPIRED": {
      const { type, states } = splitDetail(detail);
      if (states.includes("EXPIRED")) return { sentence: `Your ${named(type)} certificate has expired. Add the renewed certificate.`, step: addCredential, waiting: false };
      if (states.includes("REJECTED")) return { sentence: `Your ${named(type)} certificate could not be verified. Correct its details so it can be reviewed again.`, step: addCredential, waiting: false };
      if (states.includes("REVOKED")) return { sentence: `Your ${named(type)} certificate was revoked by our team. Contact support if you think this is a mistake.`, step: support, waiting: false };
      return { sentence: `Your ${named(type)} certificate is no longer valid. Add a current one.`, step: addCredential, waiting: false };
    }
    case "EQUIPMENT_MISSING":
      return {
        sentence: `This service needs verified, working ${named(detail)} equipment. If it is already on your credentials, check it is marked as working — otherwise it is awaiting review. If not, add it.`,
        step: addCredential,
        waiting: false,
      };
    case "INSURANCE_INVALID": {
      const { type, states } = splitDetail(detail);
      if (states.length === 0 || states.includes("MISSING")) return { sentence: `This service needs ${named(type)} insurance, and none is on your credentials yet.`, step: addCredential, waiting: false };
      if (states.includes("UNVERIFIED")) return { sentence: `Your ${named(type)} insurance is awaiting review by our team. There is nothing more you need to do.`, step: viewCredential, waiting: true };
      if (states.includes("EXPIRED")) return { sentence: `Your ${named(type)} insurance has expired. Add the renewed policy.`, step: addCredential, waiting: false };
      if (states.includes("NOT_YET_EFFECTIVE")) return { sentence: `Your ${named(type)} insurance has not started yet. It will count from its start date.`, step: viewCredential, waiting: true };
      if (states.includes("REJECTED")) return { sentence: `Your ${named(type)} insurance could not be verified. Correct its details so it can be reviewed again.`, step: addCredential, waiting: false };
      if (states.includes("REVOKED")) return { sentence: `Your ${named(type)} insurance was revoked by our team. Contact support if you think this is a mistake.`, step: support, waiting: false };
      return { sentence: `Your ${named(type)} insurance is not valid at the moment. Add a current policy.`, step: addCredential, waiting: false };
    }
    case "LANGUAGE_MISMATCH":
      return {
        sentence: `This service needs ${languageName(detail)} at a level your profile does not show yet. Add the language or update your proficiency.`,
        step: addCredential,
        waiting: false,
      };
    case "KYC_UNVERIFIED":
      return { sentence: "Your identity is not verified yet. This service is only offered to verified professionals.", step: verification, waiting: false };
    case "BACKGROUND_CHECK_NOT_CLEARED":
      if (detail === "PENDING") return { sentence: "Your background check is being reviewed. There is nothing more you need to do.", step: verification, waiting: true };
      if (detail === "FAILED") return { sentence: "Your background check was not cleared — contact support.", step: support, waiting: false };
      if (detail === "NOT_DONE") return { sentence: "Your background check is not done yet. This service needs a cleared check.", step: verification, waiting: false };
      return { sentence: "This service needs a cleared background check, and yours is not recorded as cleared.", step: verification, waiting: false };
    case "EXPERIENCE_INSUFFICIENT": {
      const m = /^(\d+)<(\d+)$/.exec(detail);
      if (!m) return { sentence: "This service needs more experience than your profile shows.", step: null, waiting: false };
      const have = Number(m[1]);
      const need = Number(m[2]);
      return { sentence: `This service needs at least ${need} year${need === 1 ? "" : "s"} of experience; your profile shows ${have}.`, step: null, waiting: false };
    }
    case "TRAINING_INCOMPLETE": {
      const title = typeof gap.title === "string" && gap.title.trim() ? gap.title.trim() : humanizeCode(detail);
      return { sentence: `Complete the training "${title}" in the Academy.`, step: { href: READINESS_LINKS.academy, label: "Open the Academy" }, waiting: false };
    }
    default:
      return { sentence: "One of this service's requirements is not met yet. Contact support to find out what is needed.", step: support, waiting: false };
  }
}

/** The lines for one service. Empty when ready or when the server sent no readiness. */
export function describeReadiness(readiness: ServiceReadiness | null | undefined): ReadinessLine[] {
  if (!readiness || readiness.ready || !Array.isArray(readiness.missing)) return [];
  return readiness.missing.map(describeReadinessGap);
}

export type ReadinessSummary = { total: number; notReady: number; sentence: string | null };

/**
 * The page-level line. Counts only services the server reported readiness for; `null` when it
 * reported none (older backend) — the page then shows no readiness UI. `sentence` is null when
 * every service is ready: good news needs no banner.
 */
export function summarizeReadiness(performing: ReadonlyArray<{ readiness?: ServiceReadiness | null }>): ReadinessSummary | null {
  const known = performing.filter((s) => s.readiness && typeof s.readiness.ready === "boolean");
  if (known.length === 0) return null;
  const notReady = known.filter((s) => !s.readiness!.ready).length;
  const total = known.length;
  const sentence =
    notReady === 0
      ? null
      : total === 1
        ? "Your service is not being offered jobs yet."
        : notReady === total
          ? `None of your ${total} services are being offered jobs yet.`
          : `${notReady} of your ${total} services ${notReady === 1 ? "is" : "are"} not being offered jobs yet.`;
  return { total, notReady, sentence };
}
