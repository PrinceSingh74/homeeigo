/**
 * The withdraw form's logic (`POST /api/wallet/withdraw`). Pure and import-free: no React Native.
 *
 * The format checks below repeat the server's own body schema (backend `schemas/payment.schema.ts`
 * `walletWithdrawSchema`: a positive amount, 9–18 account digits, an 11-character IFSC, a 2–100
 * character holder name) so a typo is caught before the request — they are not limits invented here,
 * and the server stays the judge. The server sends no minimum and no fee before a withdrawal exists,
 * so none is shown.
 */

export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type WithdrawForm = {
  amountText: string;
  accountHolder: string;
  bankAccountNumber: string;
  ifscCode: string;
};

export type WithdrawFieldErrors = Partial<Record<keyof WithdrawForm, string>>;

/** The typed amount as rupees with at most two decimals, or null when it is not such a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * `availableBalance` is the figure the app has JUST read from the server, or null when it has no
 * fresh one (the read is still running, or failed). A cached figure is never passed: money may have
 * arrived since, and the server is the judge of the balance — the phone only flags an amount that is
 * plainly over a figure it read a moment ago. `formatAmount` words the balance inside the message
 * (the screen passes its rupee formatter).
 */
export function validateWithdrawForm(form: WithdrawForm, availableBalance: number | null, formatAmount: (amount: number) => string): WithdrawFieldErrors {
  const errors: WithdrawFieldErrors = {};
  const amount = parseAmount(form.amountText);
  if (amount === null || amount <= 0) errors.amountText = "Enter a valid amount";
  else if (availableBalance !== null && amount > availableBalance) errors.amountText = `Amount cannot exceed available balance (${formatAmount(availableBalance)})`;
  const holder = form.accountHolder.trim();
  if (holder.length < 2 || holder.length > 100) errors.accountHolder = "Enter the account holder name";
  if (!/^\d{9,18}$/.test(form.bankAccountNumber.replace(/\s/g, ""))) errors.bankAccountNumber = "Enter a valid bank account number";
  if (!IFSC_REGEX.test(form.ifscCode.trim().toUpperCase())) errors.ifscCode = "Enter a valid IFSC code";
  return errors;
}

export type WithdrawPayload = { amount: number; bankAccountNumber: string; ifscCode: string; accountHolder: string };

/** The request body for a form that passed `validateWithdrawForm`; null when it has not. */
export function withdrawPayload(form: WithdrawForm): WithdrawPayload | null {
  const amount = parseAmount(form.amountText);
  if (amount === null || amount <= 0) return null;
  return {
    amount,
    bankAccountNumber: form.bankAccountNumber.replace(/\s/g, ""),
    ifscCode: form.ifscCode.trim().toUpperCase(),
    accountHolder: form.accountHolder.trim(),
  };
}

export type KeyedRequest = { signature: string; key: string };

/** Request signature → the idempotency key still owed an answer. */
export type WithdrawKeyLedger = Map<string, string>;

export function createWithdrawKeyLedger(): WithdrawKeyLedger {
  return new Map();
}

/**
 * The keys of withdrawals whose outcome this app does not know yet. It outlives the withdraw sheet,
 * and — saved by `lib/withdraw-key-store.ts` — the app process too: the server dedupes by key alone, so a sheet that forgot its key
 * on close would turn "the answer was lost" into a second withdrawal on reopen.
 */
export const withdrawKeyLedger: WithdrawKeyLedger = createWithdrawKeyLedger();

/**
 * The idempotency key for this exact request by this account. The server answers a repeated key with
 * the withdrawal it already created, so a retry of the SAME request must reuse the key (a lost answer
 * cannot become a second withdrawal) and a CHANGED request must get a new one (otherwise the server
 * would hand back the earlier withdrawal, for the earlier amount, as if it were this one). The key
 * stays in the ledger until `settleRequest` is told the server answered.
 */
export function keyForRequest(ledger: WithdrawKeyLedger, owner: string, payload: WithdrawPayload, generate: () => string): KeyedRequest {
  const signature = [owner, payload.amount, payload.bankAccountNumber, payload.ifscCode, payload.accountHolder].join("|");
  let key = ledger.get(signature);
  if (!key) {
    key = generate();
    ledger.set(signature, key);
  }
  return { signature, key };
}

/**
 * Whether the server ANSWERED the request. `null` is success. A refusal the server chose (a 4xx)
 * is an answer: nothing was created. Everything else leaves the outcome unknown — no connection (the
 * request may have landed and only the answer was lost), and a 5xx (the route answers 500 after
 * creating the withdrawal when it cannot read it back; a gateway error says nothing either way).
 */
export function withdrawOutcome(error: unknown): "answered" | "unknown" {
  if (error === null) return "answered";
  const status = (typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined) as unknown;
  return typeof status === "number" && status >= 400 && status < 500 ? "answered" : "unknown";
}

/** Only an answer retires a key; while the outcome is unknown the same request keeps the same key. */
export function settleRequest(ledger: WithdrawKeyLedger, signature: string, outcome: "answered" | "unknown"): void {
  if (outcome === "answered") ledger.delete(signature);
}

const CHECK_BEFORE_RETRY =
  "Check Recent withdrawals in your wallet before trying again. Trying again with the same details cannot create a second withdrawal.";

export type VerificationNotice = { sent: boolean; title: string; message: string };

/**
 * What to say after asking for a verification link (`POST /api/auth/send-verification-email`). The
 * route answers success with `email: null` — and sends nothing — when the account has no email
 * address, so its "Verification email sent" is repeated only when it names where the email went.
 */
export function verificationNotice(
  answer: { message?: string | null; email?: string | null; expiresAt: string },
  formatWhen: (iso: string) => string,
): VerificationNotice {
  const email = typeof answer.email === "string" ? answer.email.trim() : "";
  if (!email) {
    return {
      sent: false,
      title: "There is no email address on your account",
      message: "A verification link has nowhere to go, so withdrawals stay locked. Contact support to add an email address to your account.",
    };
  }
  return {
    sent: true,
    title: answer.message || "Verification email sent",
    message: `Sent to ${email}. Open the link in that email (it works until ${formatWhen(answer.expiresAt)}), then come back and request the withdrawal again.`,
  };
}

export type WithdrawRefusal = {
  kind: "offline" | "unconfirmed" | "email_unverified" | "insufficient_balance" | "refused";
  /** The server's sentence, unchanged; for `offline`, the app's own (the server said nothing). */
  sentence: string;
  /** What the partner can do about it, when the app knows. */
  note: string | null;
};

/**
 * What to show for a failed withdraw. The server's sentence always comes first and is never
 * reworded. The error is read structurally (the shape of `PartnerApiError`: `status`, `code`,
 * `message`, `details`) so this file needs no import.
 */
export function withdrawRefusal(error: unknown): WithdrawRefusal {
  const e = (typeof error === "object" && error !== null ? error : {}) as { status?: unknown; code?: unknown; message?: unknown; details?: unknown };
  const code = typeof e.code === "string" ? e.code : null;
  const message = typeof e.message === "string" ? e.message : "";
  const details = Array.isArray(e.details) ? e.details.filter((d): d is string => typeof d === "string" && d.length > 0) : [];

  if (e.status === 0 && code === "NETWORK_ERROR") {
    return {
      kind: "offline",
      sentence: "You're offline. Check your connection and try again.",
      note: `Your request may still have reached the server. ${CHECK_BEFORE_RETRY}`,
    };
  }
  if (typeof e.status === "number") {
    const sentence = details.length ? details.join(". ") : message || "The withdrawal was refused.";
    if (e.status >= 500) {
      return { kind: "unconfirmed", sentence, note: `The server did not confirm what happened to this request. ${CHECK_BEFORE_RETRY}` };
    }
    if (code === "EMAIL_NOT_VERIFIED") {
      return {
        kind: "email_unverified",
        sentence,
        note: "Withdrawals need a verified email address. Ask for a verification link, open it from your email, then request the withdrawal again.",
      };
    }
    if (code === "INSUFFICIENT_BALANCE") {
      return {
        kind: "insufficient_balance",
        sentence,
        // The route answers every failure of the withdrawal step with this code, so its sentence may not be the cause.
        note: "The server gives this same answer when a withdrawal fails for another reason. If your available balance covers the amount, wait a moment and try again, or contact support.",
      };
    }
    return { kind: "refused", sentence, note: null };
  }
  return { kind: "refused", sentence: message || "The withdrawal could not be requested.", note: null };
}

/* ------------------------------------------------- keys that survive a restart */

/**
 * How long a key owed an answer is kept. Long enough for "the answer was lost, the app was closed,
 * I tried again that evening"; short enough that the same amount to the same account next week is a
 * new withdrawal and not an echo of the old one.
 */
export const WITHDRAW_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/** Signature → when its key was first saved. */
export type WithdrawKeyStamps = Map<string, number>;

/** The ledger as text for secure storage. A key keeps the time it was FIRST saved. */
export function encodeWithdrawKeys(ledger: WithdrawKeyLedger, stamps: WithdrawKeyStamps, now: number): string {
  const out: Record<string, { key: string; at: number }> = {};
  for (const [signature, key] of ledger) out[signature] = { key, at: stamps.get(signature) ?? now };
  return JSON.stringify(out);
}

/**
 * Fills `ledger` from stored text, skipping anything unreadable or older than the TTL, and never
 * replacing a key the running app already holds. Returns the timestamps of what it restored.
 */
export function decodeWithdrawKeys(text: string | null | undefined, ledger: WithdrawKeyLedger, now: number): WithdrawKeyStamps {
  const stamps: WithdrawKeyStamps = new Map();
  if (!text) return stamps;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return stamps;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return stamps;
  for (const [signature, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, at } = entry as { key?: unknown; at?: unknown };
    if (typeof key !== "string" || !key || typeof at !== "number" || !Number.isFinite(at)) continue;
    if (now - at > WITHDRAW_KEY_TTL_MS) continue;
    if (!ledger.has(signature)) ledger.set(signature, key);
    stamps.set(signature, at);
  }
  return stamps;
}
