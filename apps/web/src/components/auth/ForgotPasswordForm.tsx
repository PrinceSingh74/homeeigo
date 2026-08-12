"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/buttons/Button";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { Input } from "@/components/ui/Input";
import { forgotPasswordSchema, type ForgotPasswordFormValues } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

export function ForgotPasswordForm() {
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [values, setValues] = useState<ForgotPasswordFormValues>({ email: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ForgotPasswordFormValues, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors({ email: parsed.error.issues[0]?.message });
      return;
    }
    setFieldErrors({});

    setIsLoading(true);
    const result = await runAuthAction(
      () => forgotPassword(parsed.data.email.trim()),
      setError,
    );
    setIsLoading(false);

    if (result.ok) {
      setSent(true);
      showToast("If an account exists, reset instructions were sent.", "success");
    }
  }

  return (
    <AuthPageShell
      title="Reset your password"
      subtitle="Enter the email linked to your account. We'll send a secure reset link."
      badge="Account recovery"
      backHref="/login"
      footer={<AuthFooterLink prompt="Remember your password?" href="/login" label="Back to sign in" />}
    >
      {sent ? (
        <div className="space-y-4 text-center">
          <p className="text-sm leading-relaxed text-muted">
            If <span className="font-semibold text-content">{values.email}</span> is registered,
            check your inbox for a reset link. In development, the token is logged by the API
            server.
          </p>
          <ButtonLink href="/login" variant="outline" fullWidth size="lg">
            Return to sign in
          </ButtonLink>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            isRequired
            value={values.email}
            onChange={(e) => setValues({ email: e.target.value })}
            errorMessage={fieldErrors.email}
            iconLeft={<Mail className="size-4 text-muted" aria-hidden />}
            disabled={isLoading}
          />

          {storeError ? (
            <p className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
              {storeError}
            </p>
          ) : null}

          <Button type="submit" fullWidth size="lg" isLoading={isLoading} icon={<Send className="size-4" />}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthPageShell>
  );
}
