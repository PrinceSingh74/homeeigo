import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your HOMEEIGO account to book trusted home services, track bookings, and manage your wallet.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}
