/**
 * Small account rules the profile, support, documents and safety screens share. Pure (type imports
 * only). Each mirrors a server rule named beside it; none of them replaces the server's check — they
 * only stop a request the server is certain to refuse.
 */
import type { AuthSession, PartnerDocument, SafetyReportType } from "@/types/partner";

/* ---------------------------------------------------------------- identity */

/** Partners are `VENDOR` on the server (there is no PROVIDER role). A role the server did not send is not shown. */
export function roleLabel(role: string | null | undefined): string | null {
  if (role === "VENDOR") return "Partner";
  if (role === "ADMIN") return "Administrator";
  if (role === "CUSTOMER") return "Customer";
  return null;
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  const name = [first, last].map((p) => p?.trim()).filter(Boolean).join(" ");
  return name || null;
}

/* ---------------------------------------------------------------- password */

/** `POST /api/auth/change-password`: 8–128 characters with upper, lower, digit and special. */
export function passwordProblems(password: string): string[] {
  const out: string[] = [];
  if (password.length < 8) out.push("at least 8 characters");
  if (password.length > 128) out.push("at most 128 characters");
  if (!/[A-Z]/.test(password)) out.push("an uppercase letter");
  if (!/[a-z]/.test(password)) out.push("a lowercase letter");
  if (!/\d/.test(password)) out.push("a number");
  if (!/[^A-Za-z0-9]/.test(password)) out.push("a special character");
  return out;
}

/** What stops the change-password form being sent, or null. */
export function changePasswordError(input: { current: string; next: string; confirm: string }): string | null {
  if (!input.current) return "Enter your current password.";
  const problems = passwordProblems(input.next);
  if (problems.length) return `Your new password needs ${problems.join(", ")}.`;
  if (input.next === input.current) return "Your new password must be different from the current one.";
  if (input.next !== input.confirm) return "The two new passwords do not match.";
  return null;
}

/* ---------------------------------------------------------------- sessions */

/** A session's name: the device name the server stored, else what it is — never an invented device. */
export function sessionTitle(session: Pick<AuthSession, "deviceName" | "isCurrent">): string {
  const name = session.deviceName?.trim();
  if (name) return session.isCurrent ? `${name} (this device)` : name;
  return session.isCurrent ? "This device" : "Unnamed device";
}

/** This device first, then most recently active. */
export function sortSessions<T extends Pick<AuthSession, "isCurrent" | "lastActivityAt" | "createdAt">>(sessions: ReadonlyArray<T>): T[] {
  const at = (s: T) => Date.parse(s.lastActivityAt ?? s.createdAt) || 0;
  return [...sessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || at(b) - at(a));
}

/* ----------------------------------------------------------------- support */

/**
 * `category` is free text on the server (2–80 characters; no enum, no list endpoint). These are the
 * six the partner web app sends (apps/partner-web SupportCenter `CATEGORIES`), so both apps file
 * tickets under the same names.
 */
export const SUPPORT_CATEGORIES = ["Payout issue", "Booking dispute", "Account & verification", "App & technical", "Policy question", "Other"] as const;

/**
 * `priorityLevel` is optional. The server honours HIGH only with a membership / priority support and
 * otherwise records NORMAL, so the app offers the two a partner can always get and shows the
 * priority the server answered with.
 */
export const SUPPORT_PRIORITIES = [
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
] as const;

export type SupportDraft = { subject: string; description: string; category: string; bookingRef: string };

/** `POST /api/support/tickets`: subject 3–200, description 10–5000, category 2–80. */
export function supportDraftErrors(draft: SupportDraft): Partial<Record<"subject" | "description" | "category", string>> {
  const errors: Partial<Record<"subject" | "description" | "category", string>> = {};
  const subject = draft.subject.trim();
  const description = draft.description.trim();
  if (subject.length < 3) errors.subject = "Write a short subject (at least 3 characters).";
  else if (subject.length > 200) errors.subject = "Keep the subject under 200 characters.";
  if (description.length < 10) errors.description = "Describe what happened (at least 10 characters).";
  else if (description.length > 5000) errors.description = "Keep the description under 5,000 characters.";
  if (draft.category.trim().length < 2) errors.category = "Choose what this is about.";
  return errors;
}

/** `POST /api/support/tickets/:id/reply`: 1–5000 characters; a closed ticket refuses (400 CLOSED). */
export function canReply(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() !== "closed";
}

export function ticketStatusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    default:
      return status ? status.replace(/_/g, " ") : "Unknown";
  }
}

export function ticketStatusTone(status: string | null | undefined): "info" | "warning" | "success" | "neutral" {
  const s = (status ?? "").toLowerCase();
  if (s === "open") return "info";
  if (s === "in_progress") return "warning";
  if (s === "resolved") return "success";
  return "neutral";
}

/** Whose message it is. `authorRole` is "partner" / "user" for the caller's side; anything else is the support team. */
export function isOwnMessage(authorRole: string | null | undefined): boolean {
  const r = (authorRole ?? "").toLowerCase();
  return r === "partner" || r === "user" || r === "vendor" || r === "customer";
}

/* --------------------------------------------------------------- documents */

/**
 * `documentType` is free text on the server (cut to 80 characters). These are the values the server
 * itself recognises: `pan` / `aadhar` (KYC), `bank_cheque` (onboarding), `insurance`, `license`,
 * `certificate` (compliance-expiry.service `categorize`).
 */
export const DOCUMENT_TYPES = [
  { id: "pan", label: "PAN card" },
  { id: "aadhar", label: "Aadhaar card" },
  { id: "bank_cheque", label: "Cancelled cheque" },
  { id: "insurance", label: "Insurance" },
  { id: "license", label: "Licence" },
  { id: "certificate", label: "Certificate" },
] as const;

/** A document's name: the type's label when it is one the app knows, else the server's own text. */
export function documentTitle(doc: Pick<PartnerDocument, "documentType" | "documentName">): string {
  const known = DOCUMENT_TYPES.find((t) => t.id === doc.documentType.toLowerCase());
  if (known) return known.label;
  return doc.documentType.replace(/_/g, " ") || doc.documentName || "Document";
}

/** `POST /api/providers/me/documents` accepts at most 5 MB after decoding (document-upload.service). */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export type DocumentState = { label: string; tone: "success" | "warning" | "danger" | "neutral"; locked: boolean };

/**
 * What the server says about a document. `isVerified` and `expiryDate` are its fields; "expired" is
 * the one thing read off the date here (the compliance read carries the server's own `expiryState`
 * and is preferred when the screen has it). A verified document cannot be edited — only replaced by
 * a new upload (409 DOCUMENT_LOCKED).
 */
export function documentState(doc: Pick<PartnerDocument, "isVerified" | "expiryDate">, nowMs: number, serverExpiryState?: string | null): DocumentState {
  const state = (serverExpiryState ?? "").toUpperCase();
  const expiryMs = doc.expiryDate ? Date.parse(doc.expiryDate) : NaN;
  const expired = state ? state === "EXPIRED" : Number.isFinite(expiryMs) && expiryMs < nowMs;
  if (expired) return { label: "Expired", tone: "danger", locked: doc.isVerified };
  if (state === "EXPIRING_URGENT" || state === "EXPIRING_SOON") return { label: doc.isVerified ? "Verified, expires soon" : "Not verified, expires soon", tone: "warning", locked: doc.isVerified };
  if (doc.isVerified) return { label: "Verified", tone: "success", locked: true };
  return { label: "Not verified yet", tone: "neutral", locked: false };
}

/** Bytes a base64 string decodes to (padding and whitespace allowed for). */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  if (!clean.length) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** JPEG / PNG / WebP by the file's first bytes — what the server checks; the picker's claimed type is not trusted. */
export function sniffDocumentImage(base64: string): "image/jpeg" | "image/png" | "image/webp" | null {
  const head = base64.replace(/\s/g, "").slice(0, 24);
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  // "RIFF" + 4 size bytes + "WEBP": bytes 9–11 ("EBP") are the fourth base64 group whatever the size.
  if (head.startsWith("UklGR") && head.slice(12, 16) === "RUJQ") return "image/webp";
  return null;
}

export type DocumentPick = { base64: string | null | undefined; fileName?: string | null };

export type DocumentFileCheck = { ok: true; file: string; fileName: string } | { ok: false; message: string };

/** Turns a picked photo into the `file` the endpoint takes (a data URL), or says why it cannot be sent. */
export function checkDocumentFile(pick: DocumentPick, documentType: string): DocumentFileCheck {
  const base64 = pick.base64?.trim();
  if (!base64) return { ok: false, message: "That photo could not be read. Take or choose it again." };
  const mime = sniffDocumentImage(base64);
  if (!mime) return { ok: false, message: "Send a JPEG, PNG or WebP photo. This format is not accepted." };
  if (base64Bytes(base64) > DOCUMENT_MAX_BYTES) return { ok: false, message: "That photo is larger than 5 MB. Take it again at a lower resolution." };
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const safeType = documentType.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "document";
  return { ok: true, file: `data:${mime};base64,${base64}`, fileName: `${safeType}.${ext}` };
}

/** "2027-03-31" → the same string when it is a real calendar date, else null. Empty is "no date". */
export function isoDateOrNull(raw: string): string | null {
  const t = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
}

/* ------------------------------------------------------------------ safety */

/** The server's report types (`POST /api/providers/me/safety/report`), in the order a partner needs them. */
export const SAFETY_REPORT_TYPES: ReadonlyArray<{ value: SafetyReportType; label: string }> = [
  { value: "THREAT", label: "I was threatened" },
  { value: "ACCIDENT", label: "An accident" },
  { value: "MEDICAL", label: "A medical problem" },
  { value: "PARTNER_SAFETY", label: "I do not feel safe" },
  { value: "CUSTOMER_SAFETY", label: "The customer is at risk" },
  { value: "LOCATION_DANGER", label: "The place is dangerous" },
  { value: "OTHER", label: "Something else" },
];

export function safetyTypeLabel(type: string | null | undefined): string {
  if ((type ?? "").toUpperCase() === "SOS") return "SOS";
  return SAFETY_REPORT_TYPES.find((t) => t.value === type)?.label ?? (type ? type.replace(/_/g, " ").toLowerCase() : "Incident");
}

/** A phone number good enough to dial: digits with an optional leading +. Null otherwise (nothing is dialled). */
export function dialable(phone: string | null | undefined): string | null {
  const t = (phone ?? "").replace(/[\s()-]/g, "");
  return /^\+?\d{3,15}$/.test(t) ? t : null;
}
