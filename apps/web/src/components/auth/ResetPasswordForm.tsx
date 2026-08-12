"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/buttons/Button";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { Input } from "@/components/ui/Input";
import { resetPasswordSchema, type ResetPasswordFormValues } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const resetPassword = useAuthStore((s) => s.resetPassword);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [values, setValues] = useState<ResetPasswordFormValues>({
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof ResetPasswordFormValues, string>>
  >({});
  const [isLoading, setIsLoading] = useState(false);

  const missingToken = !token;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (missingToken) return;

    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const errors: Partial<Record<keyof ResetPasswordFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ResetPasswordFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsLoading(true);
    const result = await runAuthAction(
      () => resetPassword(token, parsed.data.newPassword),
      setError,
    );
    setIsLoading(false);

    if (result.ok) {
      showToast("Password updated. You can sign in now.", "success");
      router.replace("/login");
    }
  }

  if (missingToken) {
    return (
      <AuthPageShell
        title="Invalid reset link"
        subtitle="This password reset link is missing or expired. Request a new one."
        badge="Account recovery"
        backHref="/forgot-password"
        footer={<AuthFooterLink prompt="Need help?" href="/login" label="Sign in" />}
      >
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted">
            Open the link from your email, or request a new reset from the forgot password page.
          </p>
          <ButtonLink href="/forgot-password" fullWidth size="lg">
            Request new link
          </ButtonLink>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Choose a new password"
      subtitle="Use a strong password you haven't used on HOMEEIGO before."
      badge="Account recovery"
      backHref="/login"
      footer={<AuthFooterLink prompt="Back to" href="/login" label="sign in" />}
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.newPassword}
          onChange={(e) => setValues((v) => ({ ...v, newPassword: e.target.value }))}
          errorMessage={fieldErrors.newPassword}
          helperText="8+ characters with uppercase, number, and special character."
          disabled={isLoading}
          showClear={false}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.confirmPassword}
          onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))}
          errorMessage={fieldErrors.confirmPassword}
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
          icon={<KeyRound className="size-4" />}
        >
          Update password
        </Button>

        <p className="text-center text-xs text-muted">
          <Link href="/forgot-password" className="font-semibold text-primary hover:text-primary/80">
            Request a new link
          </Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
