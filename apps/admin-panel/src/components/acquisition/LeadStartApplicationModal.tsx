"use client";

import { useEffect, useState } from "react";
import { Check, Copy, MessageSquare, Phone, ShieldCheck } from "lucide-react";
import { GlassModal } from "@/components/acquisition/GlassModal";
import { copyToClipboard } from "@/lib/clipboard";
import { smsHref } from "@/lib/lead-crm-utils";

type LeadStartApplicationModalProps = {
  open: boolean;
  leadName: string;
  phone: string;
  applicationUrl?: string;
  smsBody?: string;
  expiresInDays?: number;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  onStart: () => void;
};

export function LeadStartApplicationModal({
  open,
  leadName,
  phone,
  applicationUrl,
  smsBody,
  expiresInDays = 14,
  isLoading,
  error,
  onClose,
  onStart,
}: LeadStartApplicationModalProps) {
  const [copied, setCopied] = useState(false);
  const ready = Boolean(applicationUrl && smsBody);
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  const waDigits = digits.startsWith("91") ? digits : `91${digits.slice(-10)}`;

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function copyLink() {
    if (!applicationUrl) return;
    const ok = await copyToClipboard(applicationUrl);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <GlassModal
      open={open}
      title="Start application"
      subtitle={`Invite ${leadName} into Partner onboarding. No operational partner is created until they finish registration.`}
      onClose={onClose}
      isLoading={isLoading}
      footer={
        ready ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-black"
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={onStart}
              className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {isLoading ? "Creating invite…" : "Create application invite"}
            </button>
          </>
        )
      }
    >
      {!ready ? (
        <div className="space-y-3 text-sm text-[var(--color-biz-muted)]">
          <p>
            This marks the lead as Application started and generates a {expiresInDays}-day invite.
          </p>
          <p className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/40 px-3 py-2 text-xs">
            The applicant must register with the mobile ending in <span className="font-semibold text-[var(--color-biz-text)]">{last4 || "the number on file"}</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-emerald-200">Invite ready · {expiresInDays} days</p>
              <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">
                Send the link now. They must use the mobile ending in {last4 || "the number on file"}.
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              Application link
            </p>
            <p className="mt-1 break-all rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/50 px-3 py-2 text-xs leading-5">
              {applicationUrl}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-biz-line)] px-3 py-2.5 text-sm font-semibold"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={smsHref(phone, smsBody)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-biz-line)] px-3 py-2.5 text-sm font-semibold"
            >
              <Phone className="h-4 w-4" />
              SMS
            </a>
            <a
              href={`https://wa.me/${waDigits}?text=${encodeURIComponent(smsBody ?? "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366]/15 px-3 py-2.5 text-sm font-semibold text-emerald-300"
            >
              <MessageSquare className="h-4 w-4" />
              WhatsApp
            </a>
          </div>
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
    </GlassModal>
  );
}
