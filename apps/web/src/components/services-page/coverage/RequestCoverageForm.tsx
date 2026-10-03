"use client";

import { memo, useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { useRequestCoverage } from "@/hooks/use-coverage";

type Props = {
  /** Prefills from the coverage search / explorer context. */
  defaultCity?: string;
  defaultArea?: string;
  defaultSociety?: string;
  defaultPincode?: string;
  onDone?: () => void;
};

const MOBILE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
const PIN_RE = /^\d{6}$/;

/** Level 9 — Expansion Intelligence: demand capture for uncovered areas. */
export const RequestCoverageForm = memo(function RequestCoverageForm({
  defaultCity = "",
  defaultArea = "",
  defaultSociety = "",
  defaultPincode = "",
  onDone,
}: Props) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    city: defaultCity,
    area: defaultArea,
    society: defaultSociety,
    pincode: defaultPincode,
  });
  const [error, setError] = useState("");
  const request = useRequestCoverage();

  const field =
    "w-full rounded-xl border border-line bg-white/80 px-3.5 py-2.5 text-sm text-content placeholder:text-muted outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";
  const label = "mb-1 block text-xs font-semibold text-muted";

  if (request.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <div>
          <p className="font-display text-base font-bold text-content">Request received!</p>
          <p className="mt-1 text-sm text-muted">
            You&apos;re on the list — we&apos;ll notify you the moment HOMEEIGO launches in{" "}
            {form.society || form.area || "your area"}.
          </p>
        </div>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Done
          </button>
        )}
      </div>
    );
  }

  const submit = () => {
    setError("");
    if (form.name.trim().length < 2) return setError("Please enter your name");
    if (!MOBILE_RE.test(form.mobile.trim())) return setError("Enter a valid 10-digit mobile number");
    if (form.area.trim().length < 2) return setError("Please enter your area");
    if (form.pincode.trim() && !PIN_RE.test(form.pincode.trim())) return setError("Pincode must be 6 digits");
    request.mutate(
      {
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        city: form.city.trim() || undefined,
        area: form.area.trim(),
        society: form.society.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        source: "web_coverage_explorer",
      },
      { onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong — try again") },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-amber-100 text-amber-600">
          <MapPin size={18} />
        </span>
        <div>
          <p className="text-sm font-bold text-content">Request coverage in your area</p>
          <p className="text-xs text-muted">High-demand areas launch first — add yours to the list.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="cov-name">Name</label>
          <input
            id="cov-name"
            className={field}
            placeholder="Your name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className={label} htmlFor="cov-mobile">Mobile</label>
          <input
            id="cov-mobile"
            className={field}
            placeholder="98765 43210"
            inputMode="tel"
            value={form.mobile}
            onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
          />
        </div>
        <div>
          <label className={label} htmlFor="cov-area">Area</label>
          <input
            id="cov-area"
            className={field}
            placeholder="e.g. Sector 89"
            value={form.area}
            onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
          />
        </div>
        <div>
          <label className={label} htmlFor="cov-society">Society (optional)</label>
          <input
            id="cov-society"
            className={field}
            placeholder="e.g. Emaar Palm Hills"
            value={form.society}
            onChange={(e) => setForm((f) => ({ ...f, society: e.target.value }))}
          />
        </div>
        <div>
          <label className={label} htmlFor="cov-city">City (optional)</label>
          <input
            id="cov-city"
            className={field}
            placeholder="e.g. Gurgaon"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </div>
        <div>
          <label className={label} htmlFor="cov-pin">Pincode (optional)</label>
          <input
            id="cov-pin"
            className={field}
            placeholder="122051"
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "") }))}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={request.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {request.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
        {request.isPending ? "Submitting…" : "Notify me when HOMEEIGO arrives"}
      </button>
    </div>
  );
});
