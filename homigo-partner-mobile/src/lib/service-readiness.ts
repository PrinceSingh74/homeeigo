/**
 * "My services" — why a service the professional performs is, or is not, being offered jobs. Pure half.
 *
 * `GET /api/providers/me/service-skills` puts `readiness: { ready, missing[] }` on every PERFORMING
 * card: the same credential gates matching applies (backend `evaluateCredentialGates` /
 * `evaluateProfileGates`), so what is listed here is exactly what matching refuses for. This module
 * turns each gap into one plain sentence and the right next step. Rules it keeps:
 *  - a state is worded as the server sent it — PENDING is "being reviewed", FAILED "was not cleared",
 *    EXPIRED says expired, UNVERIFIED says "awaiting review";
 *  - nobody is told to add something the gap says they already added;
 *  - an unknown code becomes a neutral sentence, never a raw code;
 *  - a card without `readiness` (other lanes, older backend) has no readiness wording at all.
 *
 * No react-native imports: this file runs under `node --test`.
 */

export type ReadinessGap = { code: string; detail: string; title?: string | null };
export type ServiceReadiness = { ready: boolean; missing: ReadinessGap[] };

/** Where the next step lives. `null` = a stated fact with nothing to do in the app. */
export type ReadinessTarget = "credentials" | "academy" | "verification" | "support" | null;

/** Existing HQ screens (ids in `screens/hq-registry.tsx`). */
export const READINESS_ROUTES: Record<Exclude<ReadinessTarget, null>, string> = {
  credentials: "/hq/academy-credentials",
  academy: "/hq/academy-training",
  verification: "/hq/trust-verification",
  support: "/hq/account-support",
};

const ACTION_LABEL: Record<Exclude<ReadinessTarget, null>, string> = {
  credentials: "Open My credentials",
  academy: "Open Training",
  verification: "View verification status",
  support: "Contact support",
};

export type ReadinessLine = { text: string; target: ReadinessTarget; actionLabel: string | null };

export const READY_LABEL = "Ready for jobs";
export const NOT_READY_LABEL = "Not being offered jobs yet";

function line(text: string, target: ReadinessTarget): ReadinessLine {
  return { text, target, actionLabel: target ? ACTION_LABEL[target] : null };
}

/** `first-aid` → `First aid`. Display only. */
function readable(code: string): string {
  const words = code.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** `type:STATE|STATE` → the type and its states; a detail with no colon is all type. */
function splitDetail(detail: string): { type: string; states: string[] } {
  const i = detail.indexOf(":");
  if (i < 0) return { type: detail.trim(), states: [] };
  return { type: detail.slice(0, i).trim(), states: detail.slice(i + 1).split("|").map((s) => s.trim()).filter(Boolean) };
}

function languageName(code: string): string {
  const upper = code.trim().toUpperCase();
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code.trim().toLowerCase());
    return name && name.toLowerCase() !== code.trim().toLowerCase() ? name : upper;
  } catch {
    return upper;
  }
}

const years = (n: number) => `${n} year${n === 1 ? "" : "s"}`;

/** One missing requirement as a sentence and its next step. */
export function describeReadinessGap(gap: ReadinessGap): ReadinessLine {
  const detail = typeof gap.detail === "string" ? gap.detail : "";
  switch (gap.code) {
    case "SKILL_MISSING": {
      const name = readable(detail) || "a required skill";
      // Covers both "never declared" and "declared, not yet verified" — so neither is assumed.
      return line(`This service needs the skill “${name}” verified on your profile. Add it in My credentials; if it is already there, it counts once the Homeeigo team has verified it.`, "credentials");
    }
    case "CERTIFICATION_MISSING":
      return line(`This service needs a “${readable(detail) || "required"}” certificate, and none is on your profile. Add it in My credentials.`, "credentials");
    case "CERTIFICATION_UNVERIFIED":
      return line(`Your “${readable(detail) || "required"}” certificate is awaiting review by the Homeeigo team. Nothing more is needed from you right now.`, "credentials");
    case "CERTIFICATION_EXPIRED": {
      const { type, states } = splitDetail(detail);
      const name = readable(type) || "required";
      if (states.includes("EXPIRED")) return line(`Your “${name}” certificate has expired. Add the renewed certificate in My credentials.`, "credentials");
      if (states.includes("REJECTED")) return line(`Your “${name}” certificate was not accepted. Correct its details, or add a new one, in My credentials.`, "credentials");
      if (states.includes("REVOKED")) return line(`Your “${name}” certificate was revoked by the Homeeigo team — contact support.`, "support");
      return line(`Your “${name}” certificate is not valid at the moment. Check it in My credentials.`, "credentials");
    }
    case "EQUIPMENT_MISSING": {
      const name = readable(detail) || "the required equipment";
      // Not declared, not verified yet, out of service, or inspection overdue — the code does not say which.
      return line(`This service needs “${name}” that is verified and working. Check it in My credentials: add it if it is not listed, and make sure it is marked as working — it counts once the Homeeigo team has verified it.`, "credentials");
    }
    case "INSURANCE_INVALID": {
      const { type, states } = splitDetail(detail);
      const name = readable(type) || "required";
      if (states.length === 0 || states.includes("MISSING")) return line(`This service needs “${name}” insurance, and none is on your profile. Add it in My credentials.`, "credentials");
      if (states.includes("UNVERIFIED")) return line(`Your “${name}” insurance is awaiting review by the Homeeigo team. Nothing more is needed from you right now.`, "credentials");
      if (states.includes("NOT_YET_EFFECTIVE")) return line(`Your “${name}” insurance has not started yet. It will count from its start date.`, "credentials");
      if (states.includes("EXPIRED")) return line(`Your “${name}” insurance has expired. Add the renewed policy in My credentials.`, "credentials");
      if (states.includes("REJECTED")) return line(`Your “${name}” insurance was not accepted. Correct its details, or add a new policy, in My credentials.`, "credentials");
      if (states.includes("REVOKED")) return line(`Your “${name}” insurance was revoked by the Homeeigo team — contact support.`, "support");
      return line(`Your “${name}” insurance is not valid at the moment. Check it in My credentials.`, "credentials");
    }
    case "LANGUAGE_MISMATCH": {
      const name = detail.trim() ? languageName(detail) : "a required language";
      return line(`This service needs you to speak ${name} at the level it asks for. Add it, or update your level, in My credentials.`, "credentials");
    }
    case "KYC_UNVERIFIED":
      return line("Your identity is not verified yet. The Homeeigo team verifies it — you can see the current status under Verification.", "verification");
    case "BACKGROUND_CHECK_NOT_CLEARED": {
      if (detail === "PENDING") return line("Your background check is being reviewed. Nothing more is needed from you right now.", "verification");
      if (detail === "FAILED") return line("Your background check was not cleared — contact support.", "support");
      if (detail === "NOT_DONE") return line("Your background check is not done yet. The Homeeigo team carries it out — you can see the current status under Verification.", "verification");
      return line("Your background check is not cleared yet. You can see the current status under Verification.", "verification");
    }
    case "EXPERIENCE_INSUFFICIENT": {
      const m = /^(\d+)<(\d+)$/.exec(detail.trim());
      if (!m) return line("This service needs more experience than your profile shows.", null);
      return line(`This service needs at least ${years(Number(m[2]))} of experience; your profile shows ${Number(m[1])}.`, null);
    }
    case "TRAINING_INCOMPLETE": {
      const name = (typeof gap.title === "string" && gap.title.trim()) || readable(detail);
      return line(name ? `Complete the training “${name}” in the Partner Academy.` : "Complete the training this service requires in the Partner Academy.", "academy");
    }
    default:
      return line("One requirement for this service is not met yet. Contact support if you need help with it.", "support");
  }
}

export type ReadinessView = { ready: boolean; glyph: string; label: string; lines: ReadinessLine[] };

/**
 * What a PERFORMING card shows, or `null` when the server sent no readiness (older backend) — in
 * which case nothing about readiness is rendered. `ready: false` with an empty `missing` list still
 * reads as not ready, with the neutral sentence.
 */
export function readinessView(readiness: ServiceReadiness | null | undefined): ReadinessView | null {
  if (!readiness || typeof readiness.ready !== "boolean") return null;
  if (readiness.ready) return { ready: true, glyph: "✓", label: READY_LABEL, lines: [] };
  const missing = Array.isArray(readiness.missing) ? readiness.missing : [];
  const lines = missing.length ? missing.map(describeReadinessGap) : [describeReadinessGap({ code: "", detail: "" })];
  return { ready: false, glyph: "⚠", label: NOT_READY_LABEL, lines };
}

/** The line at the top of the screen: only when a performing service is not ready; otherwise nothing. */
export function readinessSummary(performing: ReadonlyArray<{ readiness?: ServiceReadiness | null }>): string | null {
  const notReady = performing.filter((c) => c.readiness && c.readiness.ready === false).length;
  if (notReady === 0) return null;
  const judged = performing.filter((c) => c.readiness && typeof c.readiness.ready === "boolean").length;
  return notReady === 1
    ? `1 of your ${judged} service${judged === 1 ? "" : "s"} is not being offered jobs yet. See what is missing below.`
    : `${notReady} of your ${judged} services are not being offered jobs yet. See what is missing below.`;
}

/** What a refused service request / withdrawal means to the professional — never a raw code. */
export function describeServiceRequestError(code: string | null | undefined, message?: string | null): string {
  switch (code) {
    case "ALREADY_OFFERED":
      return "You already perform this service.";
    case "CAPABILITY_LOCKED":
      return "This service was decided by the Homeeigo team and cannot be changed here — contact support.";
    case "SERVICE_NOT_FOUND":
    case "SERVICE_NOT_OPERATIONAL":
      return "This service is not open for requests right now.";
    case "BUSINESS_NOT_AUTHORIZED":
    case "BUSINESS_NOT_FOUND":
    case "BUSINESS_NOT_ACTIVE":
      return "This service is run by a business you are not an active member of.";
    case "NOT_DEPLOYED":
      return "Service requests are not available yet.";
    case "NOT_FOUND":
      return "This request no longer exists. Refresh and try again.";
    default:
      // The server falls back to the code itself as the message; that is never shown.
      return message && !/^[A-Z0-9_]+$/.test(message.trim()) ? message : "Something went wrong. Try again.";
  }
}
