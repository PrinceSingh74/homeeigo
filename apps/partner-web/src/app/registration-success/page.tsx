"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";

function SuccessContent() {
  const searchParams = useSearchParams();
  const providerId = searchParams.get("providerId");

  return (
    <div className="partner-mesh flex min-h-dvh items-center justify-center px-4 py-12">
      <PartnerCard className="max-w-md p-8 text-center">
        <div className="text-5xl" aria-hidden>
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold">Application submitted</h1>
        <p className="mt-2 text-sm text-[var(--color-partner-muted)]">
          Thank you for registering with HOMEEIGO. Our team will review your application within
          1–2 business days.
        </p>

        <div className="mt-6 rounded-lg border border-partner-primary/30 bg-partner-primary/10 px-4 py-3 text-left text-sm">
          <p className="font-medium text-partner-primary">What happens next?</p>
          <p className="mt-1 text-[var(--color-partner-muted)]">
            You will receive an email when your application is approved. Until then, sign-in is
            disabled for new partner accounts.
          </p>
        </div>

        <Link href="/login" className="mt-6 block">
          <PartnerButton className="w-full">Go to sign in</PartnerButton>
        </Link>

        {providerId ? (
          <p className="mt-4 text-xs text-[var(--color-partner-muted)]">
            Application ID:{" "}
            <code className="rounded bg-[var(--color-partner-elevated)] px-2 py-0.5 font-mono">
              {providerId}
            </code>
          </p>
        ) : null}
      </PartnerCard>
    </div>
  );
}

export default function RegistrationSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="partner-mesh flex min-h-dvh items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-partner-primary border-t-transparent" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
