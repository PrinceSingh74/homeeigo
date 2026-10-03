"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, MapPin, Navigation, Radio } from "lucide-react";
import {
  browserGpsAvailable,
  getPartnerCoords,
  rememberPartnerFix,
  requestLiveGps,
  type PartnerCoords,
} from "@/lib/partner-coords";
import { cn } from "@/lib/cn";

type GpsChoice = "off" | "live" | "last" | "job";

export function LocationAccessMenu({
  jobCoords,
  forceOpen,
  onResolved,
}: {
  jobCoords?: PartnerCoords | null;
  forceOpen?: boolean;
  onResolved?: (coords: PartnerCoords) => void;
}) {
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<GpsChoice>("off");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const gpsOk = typeof window === "undefined" ? true : browserGpsAvailable();

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  async function apply(next: GpsChoice) {
    setChoice(next);
    setBusy(true);
    setHint(null);
    try {
      if (next === "off") {
        setHint("GPS is off. Turn it on to arrive or start a job.");
        return;
      }
      if (next === "live") {
        if (!gpsOk) {
          setHint("This page is not localhost/https, so the browser blocked live GPS. Pick “I’m at the customer”.");
          setChoice("off");
          return;
        }
        const live = await requestLiveGps();
        if (!live) {
          setHint("Could not read GPS. Allow location in the padlock, or pick another option.");
          setChoice("off");
          return;
        }
        setHint("Live GPS is on.");
        onResolved?.(live);
        setOpen(false);
        return;
      }
      if (next === "last") {
        const last = await getPartnerCoords("soft");
        if (!last) {
          setHint("No saved GPS yet. Turn on live GPS or check in at the customer.");
          setChoice("off");
          return;
        }
        rememberPartnerFix(last.latitude, last.longitude, true);
        setHint("Using last saved GPS.");
        onResolved?.(last);
        setOpen(false);
        return;
      }
      if (next === "job") {
        if (!jobCoords) {
          setHint("Job pin is missing on this booking.");
          setChoice("off");
          return;
        }
        rememberPartnerFix(jobCoords.latitude, jobCoords.longitude, true);
        setHint("Checked in at the customer location.");
        onResolved?.(jobCoords);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const label =
    choice === "live" ? "GPS on" : choice === "last" ? "Last GPS" : choice === "job" ? "At customer" : "GPS off";

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={selectId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
          choice === "off"
            ? "border-partner-warning/40 bg-partner-warning/10 text-partner-text"
            : "border-partner-success/40 bg-partner-success/10 text-partner-text",
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Radio className={cn("h-4 w-4", choice === "off" ? "text-partner-warning" : "text-partner-success")} />
          {busy ? "Updating GPS…" : label}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-partner-muted transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={selectId}
          className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-partner-line bg-white shadow-lg"
        >
          <p className="border-b border-partner-line px-3 py-2 text-[11px] font-medium text-partner-muted">
            {gpsOk ? "Turn on GPS for arrive / start" : "Live GPS blocked on this URL — use check-in below"}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("live")}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-partner-text hover:bg-partner-bg disabled:opacity-50"
          >
            <Navigation className="h-4 w-4 text-partner-primary" />
            Turn on live GPS
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("last")}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-partner-text hover:bg-partner-bg disabled:opacity-50"
          >
            <Radio className="h-4 w-4 text-partner-muted" />
            Use last saved GPS
          </button>
          <button
            type="button"
            disabled={busy || !jobCoords}
            onClick={() => void apply("job")}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-partner-text hover:bg-partner-bg disabled:opacity-50"
          >
            <MapPin className="h-4 w-4 text-partner-success" />
            I’m at the customer
          </button>
        </div>
      ) : null}

      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-partner-muted">{hint}</p> : null}
    </div>
  );
}
