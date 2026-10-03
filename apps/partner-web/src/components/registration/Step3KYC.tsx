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
  initialValues,
}: {
  onSubmit: (data: Step3Data) => Promise<void>;
  loading: boolean;
  initialValues?: Partial<Step3Data>;
}) {
  const [formData, setFormData] = useState<Step3Data>({
    panNumber: initialValues?.panNumber ?? "",
    aadharNumber: initialValues?.aadharNumber ?? "",
    bankAccountNumber: initialValues?.bankAccountNumber ?? "",
    bankAccountHolder: initialValues?.bankAccountHolder ?? "",
    ifscCode: initialValues?.ifscCode ?? "",
    bankName: initialValues?.bankName ?? "",
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

      <label className="block text-sm">
        <span className="mb-1 block font-medium">PAN</span>
        <input
          type="text"
          name="panNumber"
          placeholder="AAAAA1234B"
          autoComplete="off"
          value={formData.panNumber}
          onChange={handleChange}
          aria-invalid={Boolean(errors.panNumber)}
          className={inputClass}
        />
      </label>
      {errors.panNumber ? <p role="alert" className="text-xs text-red-400">{errors.panNumber}</p> : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Aadhaar</span>
        <input
          type="text"
          name="aadharNumber"
          placeholder="12 digits"
          inputMode="numeric"
          autoComplete="off"
          value={formData.aadharNumber}
          onChange={handleChange}
          maxLength={12}
          aria-invalid={Boolean(errors.aadharNumber)}
          className={inputClass}
        />
      </label>
      {errors.aadharNumber ? (
        <p role="alert" className="text-xs text-red-400">{errors.aadharNumber}</p>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Bank account number</span>
        <input
          type="text"
          name="bankAccountNumber"
          placeholder="Account number"
          autoComplete="off"
          value={formData.bankAccountNumber}
          onChange={handleChange}
          className={inputClass}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Account holder name</span>
        <input
          type="text"
          name="bankAccountHolder"
          placeholder="Name as on bank account"
          value={formData.bankAccountHolder}
          onChange={handleChange}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">IFSC</span>
          <input
            type="text"
            name="ifscCode"
            placeholder="HDFC0001234"
            autoComplete="off"
            value={formData.ifscCode}
            onChange={handleChange}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Bank name</span>
          <input
            type="text"
            name="bankName"
            placeholder="HDFC Bank"
            value={formData.bankName}
            onChange={handleChange}
            className={inputClass}
          />
        </label>
      </div>

      <PartnerButton type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving…" : "Continue"}
      </PartnerButton>
    </form>
  );
}
