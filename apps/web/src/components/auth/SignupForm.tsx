"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { UserPlus } from "lucide-react";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { formatPhoneE164, PhoneField } from "@/components/auth/PhoneField";
import { OAuthProviderButtons } from "@/components/auth/OAuthProviderButtons";
import { Button } from "@/components/buttons/Button";
import { Input } from "@/components/ui/Input";
import {
  clearPendingRegistration,
  savePendingRegistration,
} from "@/lib/auth/pending-registration";
import { savePendingReferralCode } from "@/lib/auth/pending-referral";
import { signupSchema, type SignupFormValues } from "@/lib/auth/schemas";

type SignupFieldValues = Omit<SignupFormValues, "agreeToTerms">;
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const register = useAuthStore((s) => s.register);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [values, setValues] = useState<SignupFieldValues>({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof SignupFormValues, string>>
  >({});
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get("ref") ?? searchParams.get("referral");
    if (fromUrl?.trim()) {
      const code = fromUrl.trim().toUpperCase();
      setReferralCode(code);
      savePendingReferralCode(code);
    }
  }, [searchParams]);

  function readFormValues(form: HTMLFormElement): SignupFieldValues {
    const named = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    return {
      firstName: named("firstName") || values.firstName,
      lastName: named("lastName") || values.lastName,
      email: named("email") || values.email,
      phoneNumber: named("phoneNumber") || values.phoneNumber,
      password: named("password") || values.password,
      confirmPassword: named("confirmPassword") || values.confirmPassword,
    };
  }

  function validate(formValues: SignupFieldValues): boolean {
    const errors: Partial<Record<keyof SignupFormValues, string>> = {};
    if (formValues.phoneNumber.replace(/\D/g, "").length < 10) {
      errors.phoneNumber = "Enter a valid 10-digit mobile number";
    }

    const parsed = signupSchema.safeParse({
      ...formValues,
      phoneNumber: formatPhoneE164(formValues.phoneNumber),
      agreeToTerms: agreeToTerms ? true : (false as unknown as true),
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SignupFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
    }

    setFieldErrors(errors);
    return parsed.success && !errors.phoneNumber;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!agreeToTerms) {
      setFieldErrors((prev) => ({
        ...prev,
        agreeToTerms: "You must agree to the Terms and Privacy Policy",
      }));
      return;
    }
    const formValues = readFormValues(e.currentTarget);
    if (!validate(formValues)) return;

    const phoneNumber = formatPhoneE164(formValues.phoneNumber);
    const pending = {
      email: formValues.email.trim().toLowerCase(),
      phoneNumber,
      firstName: formValues.firstName.trim(),
      lastName: formValues.lastName.trim(),
      password: formValues.password,
      referralCode: referralCode.trim() ? referralCode.trim().toUpperCase() : undefined,
      agreeToTerms: true as const,
    };

    const otpRequired = true;

    setIsLoading(true);

    if (!otpRequired) {
      const result = await runAuthAction(() => register(pending), setError);
      setIsLoading(false);
      if (result.ok) {
        clearPendingRegistration();
        showToast("Welcome to HOMEEIGO", "success");
        router.replace("/");
      }
      return;
    }

    const result = await runAuthAction(() => sendOtp(phoneNumber), setError);
    setIsLoading(false);

    if (result.ok) {
      savePendingRegistration(pending);
      showToast("Verification code sent to your phone", "success");
      router.push(
        `/verify-otp?flow=register&phone=${encodeURIComponent(phoneNumber)}`,
      );
    }
  }

  return (
    <AuthPageShell
      title="Create your account"
      subtitle="Join HOMEEIGO for premium home services with AI-powered booking."
      badge="Get started"
      footer={<AuthFooterLink prompt="Already have an account?" href="/login" label="Sign in" />}
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name="firstName"
            label="First name"
            autoComplete="given-name"
            isRequired
            value={values.firstName}
            onChange={(e) => setValues((v) => ({ ...v, firstName: e.target.value }))}
            errorMessage={fieldErrors.firstName}
            disabled={isLoading}
          />
          <Input
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            isRequired
            value={values.lastName}
            onChange={(e) => setValues((v) => ({ ...v, lastName: e.target.value }))}
            errorMessage={fieldErrors.lastName}
            disabled={isLoading}
          />
        </div>

        <Input
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          isRequired
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          errorMessage={fieldErrors.email}
          disabled={isLoading}
        />

        <PhoneField
          name="phoneNumber"
          value={values.phoneNumber}
          onChange={(phoneNumber) => setValues((v) => ({ ...v, phoneNumber }))}
          errorMessage={fieldErrors.phoneNumber}
          disabled={isLoading}
          helperText="We'll send a 6-digit code to verify your number."
        />

        <Input
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          errorMessage={fieldErrors.password}
          helperText="8+ characters with uppercase, number, and special character."
          disabled={isLoading}
          showClear={false}
        />

        <Input
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.confirmPassword}
          onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))}
          errorMessage={fieldErrors.confirmPassword}
          disabled={isLoading}
          showClear={false}
        />

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line/80 bg-surface/50 p-3.5 text-sm">
          <input
            type="checkbox"
            checked={agreeToTerms}
            onChange={(e) => setAgreeToTerms(e.target.checked)}
            className="mt-0.5 size-4 rounded border-line accent-primary"
            disabled={isLoading}
          />
          <span className="text-muted">
            I agree to the{" "}
            <Link href="/legal/terms" className="font-semibold text-primary hover:underline" target="_blank">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="font-semibold text-primary hover:underline" target="_blank">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {fieldErrors.agreeToTerms ? (
          <p className="text-sm font-medium text-error" role="alert">
            {fieldErrors.agreeToTerms}
          </p>
        ) : null}

        <Input
          label="Referral code (optional)"
          type="text"
          autoComplete="off"
          value={referralCode}
          onChange={(e) => {
            const code = e.target.value.toUpperCase();
            setReferralCode(code);
            if (code.trim()) savePendingReferralCode(code);
          }}
          helperText="Have a friend's code? Enter it to reward them."
          disabled={isLoading}
          showClear={false}
        />

        {storeError ? (
          <p className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
            {storeError}
          </p>
        ) : null}

        <Button
          type="submit"
          fullWidth
          size="lg"
          isLoading={isLoading}
          icon={<UserPlus className="size-4" />}
        >
          Continue
        </Button>

        <OAuthProviderButtons disabled={isLoading} />
      </form>
    </AuthPageShell>
  );
}
