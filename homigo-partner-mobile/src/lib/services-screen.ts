/**
 * "My services" — the screen's own rules, pure half (readiness wording is in `service-readiness.ts`).
 *
 * Backend read for these: `routes/providers.ts` (`GET /me/service-skills`),
 * `services/partner-service-skills.service.ts` (`buildServiceSkillBoard`, the card shape) and
 * `services/provider-capability.service.ts` (`requestService`, `partnerDelete`).
 *
 * No react-native imports: this file runs under `node --test`.
 */
import { errorCode, errorSentence, isOfflineError, OFFLINE_SENTENCE } from "./error-sentence.ts";
import { NOT_READY_LABEL, READY_LABEL, describeServiceRequestError } from "./service-readiness.ts";

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info";
export type PillView = { label: string; tone: PillTone };
export type Notice = { tone: "success" | "info" | "warning" | "danger"; message: string };

/** The catalogue can be long; like partner web, the request list draws the first matches only. */
export const AVAILABLE_LIMIT = 40;

/**
 * The sentence after `POST /capabilities/services`. The route answers `{ row, changed }` and no
 * sentence of its own: `changed: false` means a row already existed (REQUESTED or ACTIVE) and nothing
 * new was sent, so the app does not say "Request sent".
 */
export function requestOutcome(res: { row?: { status?: unknown; [key: string]: unknown } | null; changed?: boolean }): Notice {
  if (res.changed === false) {
    return res.row?.status === "ACTIVE"
      ? { tone: "info", message: "You already perform this service." }
      : { tone: "info", message: "You already asked for this service. It is awaiting approval." };
  }
  return { tone: "success", message: "Request sent. The Homeeigo team has to approve it before you are offered jobs for this service." };
}

/** A failed request or withdrawal: the offline sentence, else the refusal in words (never a raw code). */
export function serviceFailure(error: unknown): Notice {
  if (isOfflineError(error)) return { tone: "warning", message: OFFLINE_SENTENCE };
  return { tone: "danger", message: describeServiceRequestError(errorCode(error), errorSentence(error, "")) };
}

/**
 * A card's state as a word in a pill. A performing service says ready or not only when the server
 * judged it (`readiness`); with none sent there is no pill, rather than a guess.
 */
export function lanePill(lane: string, readiness?: { ready?: unknown; missing?: unknown } | null): PillView | null {
  switch (lane) {
    case "performing":
      if (!readiness || typeof readiness.ready !== "boolean") return null;
      return readiness.ready ? { label: READY_LABEL, tone: "success" } : { label: NOT_READY_LABEL, tone: "warning" };
    case "pending":
      return { label: "Awaiting approval", tone: "info" };
    case "suspended":
      return { label: "Suspended", tone: "warning" };
    case "revoked":
      return { label: "Revoked", tone: "danger" };
    default:
      return null;
  }
}

/** The services that match a search (name or category, any case), capped at `limit`; `total` is every match. */
export function searchAvailable<C extends { name: string; category: string }>(cards: ReadonlyArray<C>, query: string, limit: number = AVAILABLE_LIMIT): { shown: C[]; total: number } {
  const q = query.trim().toLowerCase();
  const matches = q ? cards.filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)) : [...cards];
  return { shown: matches.slice(0, limit), total: matches.length };
}
