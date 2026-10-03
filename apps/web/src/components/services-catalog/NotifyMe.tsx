"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { useRequestCoverage } from "@/hooks/use-coverage";
import { useAuthStore } from "@/stores/auth-store";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/buttons/Button";
import { getErrorMessage } from "@/lib/auth/errors";
import { cn } from "@/lib/utils";

const MOBILE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
const PIN_RE = /^\d{6}$/;

/** Backend caps `source` at 60 chars. */
function launchSource(key: string): string {
  return `service_launch:${key}`.slice(0, 60);
}

const field =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-base text-content placeholder:text-muted outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

/**
 * Launch-interest capture for coming-soon services. Posts to the public,
 * rate-limited POST /api/coverage/requests (the same queue ops already
 * reviews), tagged `source = service_launch:<service>` — a real record,
 * not a toast.
 */
export function NotifyMeForm({
  sourceKey,
  serviceName,
  onDone,
  autoFocus = false,
}: {
  sourceKey: string;
  serviceName: string;
  onDone?: () => void;
  /** Only inside a dialog — never steal focus on page load. */
  autoFocus?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
    mobile: user?.phoneNumber ?? "",
    area: "",
    pincode: "",
  });
  const [error, setError] = useState("");
  const request = useRequestCoverage();

  if (request.isSuccess) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-emerald-500" aria-hidden />
        <p className="font-display text-lg font-bold text-content">You&apos;re on the list</p>
        <p className="max-w-xs text-sm text-muted">
          {request.data?.duplicate
            ? `We already have your interest in ${serviceName}.`
            : `We'll let you know when ${serviceName} launches near ${form.area}.`}
        </p>
        {onDone && (
          <Button variant="secondary" onClick={onDone} className="mt-2">
            Done
          </Button>
        )}
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.name.trim().length < 2) return setError("Please enter your name.");
    if (!MOBILE_RE.test(form.mobile.trim())) return setError("Enter a valid 10-digit mobile number.");
    if (form.area.trim().length < 2) return setError("Please enter your area or locality.");
    if (form.pincode.trim() && !PIN_RE.test(form.pincode.trim())) return setError("Pincode must be 6 digits.");
    request.mutate(
      {
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        area: form.area.trim(),
        pincode: form.pincode.trim() || undefined,
        source: launchSource(sourceKey),
      },
      { onError: (err) => setError(getErrorMessage(err)) },
    );
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted">
        Tell us where you are and we&apos;ll notify you when <strong className="text-content">{serviceName}</strong>{" "}
        is available in your area.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Name</span>
          <input className={field} autoComplete="name" value={form.name} onChange={set("name")} autoFocus={autoFocus} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Mobile number</span>
          <input
            className={field}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.mobile}
            onChange={set("mobile")}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Area / locality</span>
          <input className={field} autoComplete="address-level3" value={form.area} onChange={set("area")} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Pincode (optional)</span>
          <input
            className={field}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={form.pincode}
            onChange={set("pincode")}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-error/10 px-3.5 py-2.5 text-sm text-error">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" fullWidth disabled={request.isPending}>
        {request.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        Notify me
      </Button>
      <p className="text-center text-xs text-muted">
        See how we handle your details in our{" "}
        <Link href="/legal/privacy" className="font-medium text-brand underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

export function NotifyMeButton({
  sourceKey,
  serviceName,
  variant = "secondary",
  className,
  label = "Notify me",
}: {
  sourceKey: string;
  serviceName: string;
  variant?: "primary" | "secondary" | "inverse";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={() => setOpen(true)}
        className={cn(className)}
        aria-haspopup="dialog"
      >
        <Bell className="size-4" aria-hidden />
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Get notified: ${serviceName}`} size="md">
        <NotifyMeForm sourceKey={sourceKey} serviceName={serviceName} onDone={() => setOpen(false)} autoFocus />
      </Modal>
    </>
  );
}
