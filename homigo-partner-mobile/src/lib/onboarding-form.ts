/**
 * Partner sign-up form rules. Pure (no React Native import) so they can be unit-tested.
 *
 * The three `validate*` functions run the checks the form has always run before it sends a step —
 * the rules are unchanged, only the words are plainer. Anything the server checks beyond them
 * (password strength, IFSC shape, the 1–50 km radius, …) is refused by the server and shown in the
 * server's own sentence.
 */
import { OFFLINE_SENTENCE } from "./error-sentence.ts";
import { MOBILE_STEPPER, stepperIdForStep } from "./onboarding-catalog.ts";
import { MOBILE_STEP_LABELS, type MobileOnboardingStep } from "./onboarding-resume.ts";

/**
 * Input lengths. From the backend (`schemas/partner.schema.ts`, `schemas/auth.schema.ts`,
 * `partner-onboarding.service.ts`): names 2–50, password 8–128, OTP 6 digits, city cut at 80,
 * experience 0–50 years, radius 1–50 km, emergency contact name cut at 100, PAN 10, Aadhaar 12,
 * bank account 9–18 digits, holder and bank name 2–100, IFSC 11. `phone`, `time` and `dateOfBirth`
 * are the fixed formats the form sends (10 digits, HH:MM, YYYY-MM-DD).
 */
export const ONBOARDING_LIMITS = {
  name: 50,
  phone: 10,
  password: 128,
  otp: 6,
  city: 80,
  experienceYears: 2,
  radiusKm: 2,
  time: 5,
  dateOfBirth: 10,
  emergencyName: 100,
  pan: 10,
  aadhaar: 12,
  bankAccount: 18,
  bankHolder: 100,
  ifsc: 11,
  bankName: 100,
} as const;

/** The server's password rule (`PasswordService.validatePasswordStrength`), as guidance under the field. */
export const PASSWORD_HELP = "At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.";

export function digitsOnly(value: string, max: number): string {
  return value.replace(/\D/g, "").slice(0, max);
}

export type AccountForm = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

/** The email and mobile an account was created with in this sitting (step 1 answered). */
export type CreatedAccount = { email: string; phoneNumber: string };

/**
 * Whether the account form is being sent again for the account this sitting already created.
 * That account is waiting for its OTP: creating it again is refused by the server ("Email already
 * registered"), so the form returns to the OTP step instead of asking.
 */
export function accountAwaitsOtp(created: CreatedAccount | null, email: string, phoneNumber: string): boolean {
  if (!created) return false;
  return created.email.trim().toLowerCase() === email.trim().toLowerCase() && created.phoneNumber === phoneNumber;
}

export function validateAccount(form: AccountForm, email: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.firstName.trim().length < 2) errors.firstName = "Enter your first name (at least 2 letters).";
  if (form.lastName.trim().length < 2) errors.lastName = "Enter your last name (at least 2 letters).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
  if (!/^[0-9]{10}$/.test(form.phoneNumber.trim())) errors.phoneNumber = "Enter your 10-digit mobile number.";
  if (form.password.length < 8) errors.password = "Use at least 8 characters.";
  if (form.password !== form.confirmPassword) errors.confirmPassword = "The two passwords do not match.";
  return errors;
}

export function validateProfile(input: { dateOfBirth: string; gender: string; emergencyName: string; emergencyPhone: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth.trim())) errors.dateOfBirth = "Write the date as YYYY-MM-DD, for example 1992-04-12.";
  if (!input.gender) errors.gender = "Choose one.";
  if (input.emergencyName.trim().length < 2) errors.emergencyName = "Enter your emergency contact's name.";
  if (!/^[0-9]{10}$/.test(input.emergencyPhone.trim())) errors.emergencyPhone = "Enter a 10-digit mobile number.";
  return errors;
}

export function validateKyc(input: { panNumber: string; aadharNumber: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(input.panNumber.trim())) {
    errors.panNumber = "A PAN is 5 letters, 4 digits and 1 letter, for example AAAAA1234B.";
  }
  if (input.aadharNumber && !/^\d{12}$/.test(input.aadharNumber.trim())) {
    errors.aadharNumber = "An Aadhaar number is 12 digits.";
  }
  return errors;
}

/** Where the applicant is in the sequence, or null on the screens before and after it. */
export function stepPosition(step: MobileOnboardingStep): { number: number; total: number; label: string } | null {
  if (step === "welcome" || step === "done") return null;
  const index = MOBILE_STEPPER.findIndex((s) => s.id === stepperIdForStep(step));
  if (index < 0) return null;
  return { number: index + 1, total: MOBILE_STEPPER.length, label: MOBILE_STEP_LABELS[step] };
}

export function stepIndicatorText(step: MobileOnboardingStep): string | null {
  const p = stepPosition(step);
  return p ? `Step ${p.number} of ${p.total} · ${p.label}` : null;
}

/**
 * The sentence for a failed sign-up request. The registration client throws a plain `Error` whose
 * message is the server's `error` sentence; when there was no HTTP answer `fetch` throws a
 * `TypeError` in the runtime's words ("Network request failed", "Failed to fetch"), and an answer
 * that was not JSON throws a `SyntaxError` — neither is something to show a partner.
 */
export function registrationErrorSentence(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error instanceof SyntaxError) return fallback;
  const message = error.message.trim();
  if (error instanceof TypeError || /network request failed|failed to fetch|load failed|reach backend/i.test(message)) return OFFLINE_SENTENCE;
  return message || fallback;
}
