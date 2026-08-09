"use client";

import { useState } from "react";
import { PartnerButton } from "@/components/ui/PartnerButton";

export type Step3Data = {
  panNumber: string;
  aadharNumber: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  ifscCode: string;
  bankName: string;
};

const inputClass =
  "w-full rounded-lg border border-[var(--color-partner-border)] bg-[var(--color-partner-surface)] px-4 py-2.5 text-sm outline-none focus:border-partner-primary";

export function Step3KYC({
  onSubmit,
  loading,
}: {
  onSubmit: (data: Step3Data) => Promise<void>;
  loading: boolean;
}) {
  const [formData, setFormData] = useState<Step3Data>({
    panNumber: "",
    aadharNumber: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    ifscCode: "",
    bankName: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (formData.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(formData.panNumber)) {
      next.panNumber = "Invalid PAN (e.g. AAAAA1234B)";
    }
    if (formData.aadharNumber && !/^\d{12}$/.test(formData.aadharNumber)) {
      next.aadharNumber = "Aadhar must be 12 digits";
    }
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    await onSubmit(formData);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-xl font-semibold">KYC & banking (optional)</h2>
      <p className="text-sm text-[var(--color-partner-muted)]">
        You can skip these for now and add them later from your profile.
      </p>

      <input
        type="text"
        name="panNumber"
        placeholder="PAN (AAAAA1234B)"
        value={formData.panNumber}
        onChange={handleChange}
        className={inputClass}
      />
      {errors.panNumber ? <p className="text-xs text-red-400">{errors.panNumber}</p> : null}

      <input
        type="text"
        name="aadharNumber"
        placeholder="Aadhar (12 digits)"
        value={formData.aadharNumber}
        onChange={handleChange}
        maxLength={12}
        className={inputClass}
      />
      {errors.aadharNumber ? (
        <p className="text-xs text-red-400">{errors.aadharNumber}</p>
      ) : null}

      <input
        type="text"
        name="bankAccountNumber"
        placeholder="Bank account number"
        value={formData.bankAccountNumber}
        onChange={handleChange}
        className={inputClass}
      />

      <input
        type="text"
        name="bankAccountHolder"
        placeholder="Account holder name"
        value={formData.bankAccountHolder}
        onChange={handleChange}
        className={inputClass}
      />

      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          name="ifscCode"
          placeholder="IFSC"
          value={formData.ifscCode}
          onChange={handleChange}
          className={inputClass}
        />
        <input
          type="text"
          name="bankName"
          placeholder="Bank name"
          value={formData.bankName}
          onChange={handleChange}
          className={inputClass}
        />
      </div>

      <PartnerButton type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving…" : "Continue"}
      </PartnerButton>
    </form>
  );
}
