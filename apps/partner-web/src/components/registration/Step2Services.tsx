"use client";

import { useEffect, useState } from "react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi, type OnboardingServiceOption } from "@/services/partner-registration-api";

const CITIES = [
  "Delhi",
  "Mumbai",
  "Bangalore",
  "Hyderabad",
  "Pune",
  "Gurgaon",
  "Noida",
  "Chennai",
  "Kolkata",
  "Others",
];

export type Step2Data = {
  serviceCategories: string[];
  city: string;
  experienceYears: number;
};

export function Step2Services({
  onSubmit,
  loading,
  initialValues,
}: {
  onSubmit: (data: Step2Data) => Promise<void>;
  loading: boolean;
  initialValues?: Partial<Step2Data>;
}) {
  const [formData, setFormData] = useState<Step2Data>({
    serviceCategories: initialValues?.serviceCategories ?? [],
    city: initialValues?.city ?? "",
    experienceYears: initialValues?.experienceYears ?? 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<OnboardingServiceOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    partnerRegistrationApi
      .serviceOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data.options);
        setOptionsError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        setOptionsError("Service catalogue is unavailable. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleService(serviceId: string) {
    setFormData((prev) => ({
      ...prev,
      serviceCategories: prev.serviceCategories.includes(serviceId)
        ? prev.serviceCategories.filter((s) => s !== serviceId)
        : [...prev.serviceCategories, serviceId],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.serviceCategories.length) {
      setError("Select at least one service");
      return;
    }
    if (!formData.city) {
      setError("Select a city");
      return;
    }
    setError(null);
    await onSubmit(formData);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-xl font-semibold">Services & location</h2>

      <div>
        <label className="mb-3 block text-sm font-medium">Which services do you provide?</label>
        {optionsError ? <p className="mb-2 text-sm text-red-400">{optionsError}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {options.map((service) => {
            const checked = formData.serviceCategories.includes(service.id);
            return (
              <label
                key={service.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                  checked
                    ? "border-partner-primary bg-partner-primary/10"
                    : "border-[var(--color-partner-border)] hover:bg-[var(--color-partner-elevated)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleService(service.id)}
                  className="accent-partner-primary"
                />
                {service.label}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">City</label>
        <select
          value={formData.city}
          onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
          className="w-full rounded-lg border border-[var(--color-partner-border)] bg-[var(--color-partner-surface)] px-4 py-2.5 text-sm text-partner-text outline-none focus:border-partner-primary"
        >
          <option value="" className="bg-partner-card text-partner-text">
            Select city
          </option>
          {CITIES.map((city) => (
            <option key={city} value={city} className="bg-partner-card text-partner-text">
              {city}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Years of experience</label>
        <input
          type="number"
          min={0}
          max={50}
          value={formData.experienceYears}
          onChange={(e) =>
            setFormData((prev) => ({
              ...prev,
              experienceYears: parseInt(e.target.value, 10) || 0,
            }))
          }
          className="w-full rounded-lg border border-[var(--color-partner-border)] bg-[var(--color-partner-surface)] px-4 py-2.5 text-sm outline-none focus:border-partner-primary"
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <PartnerButton type="submit" className="w-full" disabled={loading || !options.length}>
        {loading ? "Saving…" : "Continue"}
      </PartnerButton>
    </form>
  );
}
