/**
 * Phase 10 — what a customer may know about a service BEFORE booking.
 *
 * Built only from the engines that already enforce the promise:
 *   safety.v1 customer view, quality proof flags, execution-step evidence (not the steps),
 *   warranty.v1, the follow-up fee decision, customerPolicy.age, and the completion window.
 *
 * Partner SOP, prohibited conditions, PPE, the incident protocol, checklists, matching weights,
 * and any policy this module cannot read are omitted. `warranty.guarantee` and
 * `warranty.damagePolicy` are customer-facing by definition and are shown verbatim; the older
 * `trust.guarantee` is not read here. An absent rule is omitted, never filled in.
 */
import type { ServiceCatalogConfig } from "./service-catalog-config";
import { buildSafetySnapshot, customerSafetyView } from "./service-safety";
import { buildWarrantySnapshot, type CaseCategory } from "./service-warranty";
import { followUpFeeDecision, reworkPolicyFrom } from "./booking-case-policy";
import { qualitySnapshot } from "./service-runtime-policy";
import { capabilityRequirementsFromConfig } from "./provider-capability";

/** Same predicate as booking-start-otp.service `isRequired`. */
export function startPinRequired(flag: string | undefined): boolean {
  return flag !== "false";
}

/**
 * Same bounds as booking-completion.service `confirmationWindowHours`.
 * The 48-hour default is the published dispute window that service uses when a service sets none.
 */
export function visitConfirmationHours(cfg: ServiceCatalogConfig | null): number {
  // A notApplicable quality block is not frozen, so completion falls back to the platform 48 hours.
  if (cfg?.quality?.notApplicable) return 48;
  const h = cfg?.quality?.confirmationWindowHours;
  return typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= 720 ? h : 48;
}

export type CustomerVisitStep = { code: "ARRIVAL" | "VERIFICATION" | "SERVICE" | "CONFIRMATION"; title: string; detail: string };

export type CustomerVisitSafety = {
  warnings: string[];
  customerRequirements: string[];
  /** Products that are not used, or only under a stated condition. Shown verbatim. */
  chemicalRestrictions: string[];
  information: string | null;
  medicalDisclaimer: string | null;
  emergencyProtocol: string | null;
};

export type CustomerVisit = {
  process: CustomerVisitStep[];
  safety: CustomerVisitSafety | null;
  /** Sentences only. Empty statements are omitted by using null. */
  proof: { statements: string[] } | null;
  /** `guarantee` and `damagePolicy` are the service's own configured text, shown verbatim. */
  warranty: { statements: string[]; exclusions: string[]; guarantee: string | null; damagePolicy: string | null } | null;
  age: { statement: string } | null;
};

const ISSUE_LABEL: Record<CaseCategory, string> = {
  QUALITY: "the result of the work",
  INCOMPLETE: "work left unfinished",
  DAMAGE: "damage from the visit",
  BEHAVIOUR: "how the professional behaved",
  NO_SHOW: "a missed visit",
  BILLING: "the charge for the visit",
  OTHER: "another problem with the visit",
};

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function processSteps(pin: boolean, hours: number): CustomerVisitStep[] {
  const steps: CustomerVisitStep[] = [
    {
      code: "ARRIVAL",
      title: "Arrival",
      detail: "A professional comes to your address. You can follow their arrival once they are on the way.",
    },
  ];
  if (pin) {
    steps.push({
      code: "VERIFICATION",
      title: "Start check",
      detail: "You share a start PIN when they arrive. Work does not begin until that PIN is confirmed.",
    });
  }
  steps.push({
    code: "SERVICE",
    title: "Service",
    detail: "The professional carries out the service you booked.",
  });
  steps.push({
    code: "CONFIRMATION",
    title: "Your confirmation",
    detail: `After the visit you have ${count(hours, "hour", "hours")} to confirm the work. If you do nothing, it is confirmed automatically.`,
  });
  return steps;
}

/**
 * Partner-operational emergency text ("stop work", "do not restart") is not a customer promise.
 * A line already written to the customer is kept, including a number that was actually configured.
 * A partner-only line becomes a neutral stop sentence. A phone number present in that line is
 * repeated; no number is invented when the configuration has none.
 */
export function customerEmergencyLine(protocol: string | null | undefined): string | null {
  const text = protocol?.trim();
  if (!text) return null;
  const partnerOps = /\b(stop work|do not restart|don't restart|do not resume|ppe)\b/i.test(text);
  if (!partnerOps) return text;
  const phone = text.match(/(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){8,}\d/)?.[0]?.replace(/\s+/g, " ").trim();
  const contact = phone ? ` Configured contact: ${phone}.` : "";
  return `If something is unsafe, the professional stops the service and follows the platform safety procedure.${contact}`;
}

function safetyBlock(cfg: ServiceCatalogConfig | null): CustomerVisitSafety | null {
  const view = customerSafetyView(buildSafetySnapshot(cfg));
  if (!view) return null;
  const emergencyProtocol = customerEmergencyLine(view.emergencyProtocol);
  const has =
    view.warnings.length > 0 ||
    view.customerRequirements.length > 0 ||
    view.chemicalRestrictions.length > 0 ||
    view.information ||
    view.medicalDisclaimer ||
    emergencyProtocol;
  return has ? { ...view, emergencyProtocol } : null;
}

function proofBlock(cfg: ServiceCatalogConfig | null): { statements: string[] } | null {
  const q = qualitySnapshot(cfg);
  let alwaysPhoto = q?.proofRequired === true;
  let alwaysBeforeAfter = q?.beforeAfterPhotos === true;
  let somePhoto = false;
  let someBeforeAfter = false;
  for (const step of cfg?.execution?.steps ?? []) {
    if (step.active === false) continue;
    const photo = step.evidence === "PHOTO" || step.evidence === "BEFORE_AFTER_PHOTOS";
    const beforeAfter = step.evidence === "BEFORE_AFTER_PHOTOS";
    const conditional = Boolean(step.when && (step.when.variantIds?.length || step.when.addonIds?.length || step.when.minQuantity));
    if (!photo && !beforeAfter) continue;
    if (conditional) {
      if (photo) somePhoto = true;
      if (beforeAfter) someBeforeAfter = true;
    } else {
      if (photo) alwaysPhoto = true;
      if (beforeAfter) alwaysBeforeAfter = true;
    }
  }
  const statements: string[] = [];
  if (alwaysBeforeAfter) statements.push("The professional takes before and after photos of the work.");
  else if (alwaysPhoto) statements.push("The professional takes photos of the work.");
  if (!alwaysBeforeAfter && someBeforeAfter) statements.push("Some options include before and after photos of the work.");
  else if (!alwaysPhoto && somePhoto) statements.push("Some options include photos of the work.");
  return statements.length ? { statements } : null;
}

function warrantyBlock(cfg: ServiceCatalogConfig | null): CustomerVisit["warranty"] {
  const w = buildWarrantySnapshot(cfg);
  const fee = followUpFeeDecision(reworkPolicyFrom(cfg?.rework));
  const statements: string[] = [];
  if (w.enabled && w.durationDays > 0) {
    const start = w.startEvent === "CONFIRMATION" ? "when you confirm the visit" : "when the visit is completed";
    statements.push(`This service includes a ${w.durationDays}-day cover that starts ${start}.`);
    const covered = w.eligibleIssueTypes.map((t) => ISSUE_LABEL[t]).filter(Boolean);
    if (covered.length) statements.push(`The cover applies to ${joinAnd(covered)}.`);
    if (w.proofRequired) statements.push("A report under this cover needs a photo or a note before it applies.");
    if (fee.ok && w.reworkFirst) {
      const refund = w.refundAllowed ? " A refund can be considered only after that visit is reviewed. It is not automatic." : "";
      statements.push(`A covered problem is offered a follow-up visit at no extra charge.${refund}`);
      if (fee.sameProviderPreferred) {
        statements.push("The same professional is requested first, if they can still take the job.");
      }
      if (fee.windowDays) {
        statements.push(`That follow-up has to be reported within ${count(fee.windowDays, "day", "days")} of completion.`);
      }
    } else if (w.refundAllowed) {
      statements.push("A refund can be considered after the problem is reviewed. It is not automatic.");
    }
  }
  if (w.complaintWindowDays > 0) {
    statements.push(`You can report a problem within ${count(w.complaintWindowDays, "day", "days")} of completion.`);
  }
  const guarantee = w.guarantee?.trim() || null;
  const damagePolicy = w.damagePolicy?.trim() || null;
  if (!statements.length && !guarantee && !damagePolicy) return null;
  return { statements, exclusions: w.enabled ? [...w.exclusions] : [], guarantee, damagePolicy };
}

function ageBlock(cfg: ServiceCatalogConfig | null): { statement: string } | null {
  const age = cfg?.customerPolicy?.age;
  if (!age || age.mode === "NONE") return null;
  if (age.mode === "MINIMUM_AGE" && age.minimumAge) {
    return { statement: `To book this service you must be at least ${age.minimumAge} years old.` };
  }
  if (age.mode === "ADULT_ONLY" && age.adultAge) {
    return { statement: `To book this service you must be at least ${age.adultAge} years old.` };
  }
  if (age.mode === "GUARDIAN_REQUIRED" && age.guardianMinimumAge) {
    return { statement: `A guardian who is at least ${age.guardianMinimumAge} years old must confirm this booking.` };
  }
  return null;
}

/**
 * The numeric summary some older clients read beside `visit`.
 * Warranty days come from `warranty.v1` (the snapshot booking freezes), not from the legacy
 * `quality.warrantyDays` field, which can be 0 while a typed warranty is on.
 * The checklist is never included.
 */
export function customerQualitySummary(
  cfg: ServiceCatalogConfig | null,
): { proofRequired: boolean; beforeAfterPhotos: boolean; warrantyDays: number } | null {
  const q = qualitySnapshot(cfg);
  const w = buildWarrantySnapshot(cfg);
  const warrantyDays = w.enabled ? w.durationDays : 0;
  if (!q && warrantyDays <= 0) return null;
  return {
    proofRequired: q?.proofRequired === true,
    beforeAfterPhotos: q?.beforeAfterPhotos === true,
    warrantyDays,
  };
}

export type CustomerProfessionalView = {
  statements: { code: "IDENTITY_VERIFIED" | "BACKGROUND_CHECKED" | "EXPERIENCE" | "TRAINED" | "CERTIFIED" | "INSURED"; text: string }[];
};

/**
 * What a customer may be told about the professional who will come. Read through
 * `capabilityRequirementsFromConfig`, the function matching uses, so each statement is a gate that
 * refuses a professional who does not meet it. A requirement nobody configured says nothing, and
 * the codes behind a requirement (which certificate, which module) stay internal. Null when there
 * is nothing enforced to state.
 */
export function customerProfessionalView(cfg: ServiceCatalogConfig | null): CustomerProfessionalView | null {
  const req = capabilityRequirementsFromConfig(cfg);
  const statements: CustomerProfessionalView["statements"] = [];
  if (req.profile?.kycRequired) statements.push({ code: "IDENTITY_VERIFIED", text: "Their identity is verified before they can take this job." });
  if (req.profile?.backgroundCheckRequired) statements.push({ code: "BACKGROUND_CHECKED", text: "They have a cleared background check." });
  const years = req.profile?.minExperienceYears ?? 0;
  if (years > 0) statements.push({ code: "EXPERIENCE", text: `They have at least ${years} ${years === 1 ? "year" : "years"} of experience.` });
  if ((req.profile?.trainingModules.length ?? 0) > 0) statements.push({ code: "TRAINED", text: "They have completed our training for this service." });
  if (req.requiredCertifications.length > 0) statements.push({ code: "CERTIFIED", text: "They hold the certification this service requires." });
  if (req.requiredInsurance.length > 0) statements.push({ code: "INSURED", text: "They carry the insurance this service requires." });
  return statements.length ? { statements } : null;
}

export function customerVisitPromise(
  cfg: ServiceCatalogConfig | null,
  opts?: { startPinRequired?: boolean },
): CustomerVisit {
  const pin = opts?.startPinRequired !== false;
  return {
    process: processSteps(pin, visitConfirmationHours(cfg)),
    safety: safetyBlock(cfg),
    proof: proofBlock(cfg),
    warranty: warrantyBlock(cfg),
    age: ageBlock(cfg),
  };
}
