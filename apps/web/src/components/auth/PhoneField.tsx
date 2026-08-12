"use client";

import { cn } from "@/lib/utils";

type PhoneFieldProps = {
  name?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  errorMessage?: string;
  disabled?: boolean;
  helperText?: string;
};

export function PhoneField({
  name = "phoneNumber",
  label = "Mobile number",
  value,
  onChange,
  errorMessage,
  disabled,
  helperText,
}: PhoneFieldProps) {
  return (
    <div className="w-full">
      {label ? (
        <label className="mb-1.5 block text-sm font-medium text-content">{label}</label>
      ) : null}
      <div className="flex gap-2">
        <span className="flex h-10 min-h-[44px] shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted sm:min-h-10 sm:h-10">
          +91
        </span>
        <input
          name={name}
          type="tel"
          value={value}
          disabled={disabled}
          placeholder="98765 43210"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
          className={cn(
            "min-h-[44px] flex-1 rounded-lg border bg-surface px-3.5 text-base text-content outline-none transition placeholder:text-muted sm:min-h-10 sm:h-10 sm:text-[15px]",
            errorMessage ? "border-error" : "border-line focus:border-primary",
          )}
          aria-invalid={!!errorMessage}
        />
      </div>
      {errorMessage ? (
        <p className="mt-1.5 text-sm text-error" role="alert">
          {errorMessage}
        </p>
      ) : helperText ? (
        <p className="mt-1.5 text-sm text-muted">{helperText}</p>
      ) : null}
    </div>
  );
}

export function formatPhoneE164(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  return `+91${digits}`;
}
