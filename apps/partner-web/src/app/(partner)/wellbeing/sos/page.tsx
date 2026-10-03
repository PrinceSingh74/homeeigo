"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Phone, HeartPulse } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { partnerOsKeys, usePartnerWellbeingQuery } from "@/hooks/use-partner-os";
import { partnerApi } from "@/services/partner-api";

export default function WellbeingSosPage() {
  const wellbeing = usePartnerWellbeingQuery();
  const qc = useQueryClient();
  const sosPhone = wellbeing.data?.sosPhone?.trim();
  const telHref = sosPhone ? `tel:${sosPhone.replace(/\s/g, "")}` : "tel:112";
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contact = useMutation({
    mutationFn: () =>
      partnerApi.partnerOs.updateEmergencyContact({
        emergencyContactName: name || undefined,
        emergencyContactPhone: phone || undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerOsKeys.wellbeing }),
  });

  const savedName = wellbeing.data?.emergencyContactName;
  const savedPhone = wellbeing.data?.emergencyContactPhone;

  function clearHold() {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function startHold() {
    clearHold();
    hold.current = setTimeout(() => setConfirm(true), 600);
  }

  async function activate() {
    setBusy(true);
    try {
      const data = await partnerApi.partnerOs.triggerSos();
      setResult(
        data.created
          ? "SOS sent to operations. Stay on the line if you can."
          : "SOS already active. Operations has your alert.",
      );
      setConfirm(false);
    } catch {
      setResult("Could not reach operations. Call the hotline immediately.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <HqPageShell
      title="Safety & SOS"
      description="Emergency support is real: SOS notifies operations, captures your location, and uses your emergency contact."
      icon={HeartPulse}
      stats={
        wellbeing.data
          ? [{ label: "SOS hotline", value: sosPhone ?? "112" }]
          : undefined
      }
    >
      <section className="partner-card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Emergency contact</h2>
        {wellbeing.isLoading && !wellbeing.data ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading emergency contact">
            <div className="h-4 w-56 animate-pulse rounded bg-partner-line/50" />
            <div className="h-11 animate-pulse rounded-lg bg-partner-line/40" />
          </div>
        ) : (
          <>
            <p className="text-sm text-partner-muted">
              {savedName
                ? `${savedName}${savedPhone ? ` · ${savedPhone}` : ""}`
                : "Add someone operations can reach if you activate SOS."}
            </p>
            {savedPhone ? (
              <a
                href={`tel:${savedPhone.replace(/\s/g, "")}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-partner-primary"
              >
                Call emergency contact
              </a>
            ) : null}
          </>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="min-h-11 rounded-lg border border-partner-line px-3 text-sm"
            placeholder="Name"
            aria-label="Emergency contact name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="min-h-11 rounded-lg border border-partner-line px-3 text-sm"
            placeholder="Phone"
            aria-label="Emergency contact phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-lg border border-partner-line px-4 text-sm font-semibold"
          onClick={() => contact.mutate()}
        >
          Save emergency contact
        </button>
        {contact.isError ? (
          <p className="text-xs text-red-700" role="alert">
            Could not save contact. Try again.
          </p>
        ) : null}
      </section>
      <section className="partner-card space-y-4 p-5">
        <a
          href={telHref}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-partner-line text-base font-semibold sm:w-auto sm:px-8"
        >
          <Phone className="h-5 w-5" />
          Call {sosPhone ?? "112"}
        </a>

        {!confirm ? (
          <button
            type="button"
            data-testid="sos-arm"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-partner-danger text-base font-bold text-white sm:w-auto sm:px-8"
            onMouseDown={startHold}
            onMouseUp={clearHold}
            onMouseLeave={clearHold}
            onTouchStart={startHold}
            onTouchEnd={clearHold}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setConfirm(true);
              }
            }}
            aria-label="Hold to activate SOS. Press Enter or Space to open confirmation."
          >
            Hold to activate SOS
          </button>
        ) : (
          <div className="space-y-3" role="alertdialog" aria-labelledby="sos-confirm-title">
            <p id="sos-confirm-title" className="text-sm font-semibold">
              Confirm emergency
            </p>
            <p className="text-sm text-partner-muted">
              This alerts operations with your live location. Double-tap will not create a second incident.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="sos-confirm"
                disabled={busy}
                onClick={() => void activate()}
                className="inline-flex min-h-11 items-center rounded-xl bg-partner-danger px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? "Sending…" : "Confirm emergency"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="inline-flex min-h-11 items-center rounded-xl border border-partner-line px-5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {result ? (
          <p className="text-sm" role="status">
            {result}
          </p>
        ) : null}
        <Link href="/support" className="inline-flex h-10 items-center text-sm font-semibold text-partner-primary">
          Open support ticket
        </Link>
      </section>
    </HqPageShell>
  );
}
