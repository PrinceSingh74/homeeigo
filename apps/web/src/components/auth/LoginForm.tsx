"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Mail, Smartphone } from "lucide-react";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { OAuthProviderButtons } from "@/components/auth/OAuthProviderButtons";
import { PhoneOtpLoginForm } from "@/components/auth/PhoneOtpLoginForm";
import { Button } from "@/components/buttons/Button";
import { Input } from "@/components/ui/Input";
import { loginSchema, type LoginFormValues } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

type AuthMethod = "email" | "phone";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useAppStore((s) => s.showToast);
  const login = useAuthStore((s) => s.login);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);

  const [method, setMethod] = useState<AuthMethod>("email");
  const [values, setValues] = useState<LoginFormValues>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LoginFormValues, string>>>({});
  const [isLoading, setIsLoading] = useState(false);

  function goAfterLogin() {
    showToast("Welcome back to HOMEEIGO", "success");
    const returnUrl = searchParams.get("returnUrl");
    router.replace(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/");
  }

  function switchMethod(next: AuthMethod) {
    if (next === method) return;
    setMethod(next);
    setError(null);
    setFieldErrors({});
  }

  function validate(): boolean {
    const parsed = loginSchema.safeParse(values);
    if (parsed.success) {
      setFieldErrors({});
      return true;
    }
    const errors: Partial<Record<keyof LoginFormValues, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof LoginFormValues;
      if (!errors[key]) errors[key] = issue.message;
    }
    setFieldErrors(errors);
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    const result = await runAuthAction(
      () => login(values.email.trim(), values.password),
      setError,
    );
    setIsLoading(false);

    if (result.ok) goAfterLogin();
  }

  const oauth = <OAuthProviderButtons disabled={isLoading} />;

  return (
    <AuthPageShell
      title="Welcome back"
      subtitle="Sign in with mobile, email, Google, or Apple to manage bookings, wallet, and your AI home assistant."
      footer={
        <AuthFooterLink prompt="New to HOMEEIGO?" href="/signup" label="Create account" />
      }
    >
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="mb-5 flex gap-1 rounded-xl bg-canvas p-1 dark:bg-charcoal/60"
      >
        {(
          [
            { id: "email", label: "Email", icon: Mail },
            { id: "phone", label: "Mobile", icon: Smartphone },
          ] as const
        ).map((tab) => {
          const selected = method === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => switchMethod(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition",
                selected ? "bg-surface text-content shadow-sm" : "text-muted hover:text-content",
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {method === "email" ? (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            isRequired
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            errorMessage={fieldErrors.email}
            iconLeft={<Mail className="size-4 text-muted" aria-hidden />}
            disabled={isLoading}
          />
          <div>
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              isRequired
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              errorMessage={fieldErrors.password}
              disabled={isLoading}
              showClear={false}
            />
            <div className="mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-sm font-semibold text-primary hover:text-primary/80"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {storeError ? (
            <p className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
              {storeError}
            </p>
          ) : null}

          <Button type="submit" fullWidth size="lg" isLoading={isLoading} icon={<LogIn className="size-4" />}>
            Sign in
          </Button>

          {oauth}
        </form>
      ) : (
        <PhoneOtpLoginForm
          onAuthenticated={goAfterLogin}
          oauthSlot={(disabled) => <OAuthProviderButtons disabled={disabled} />}
        />
      )}
    </AuthPageShell>
  );
}
