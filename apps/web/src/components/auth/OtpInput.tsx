"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
};

export function OtpInput({ value, onChange, disabled, error }: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  function updateAt(index: number, char: string) {
    const next = value.split("");
    while (next.length < 6) next.push("");
    next[index] = char;
    onChange(next.join("").replace(/\s/g, "").slice(0, 6));
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) {
      updateAt(index, "");
      return;
    }
    updateAt(index, digit);
    if (index < 5) inputsRef.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index]?.trim() && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) onChange(pasted);
    const focusIndex = Math.min(pasted.length, 5);
    inputsRef.current[focusIndex]?.focus();
  }

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digits[i]?.trim() ? digits[i] : ""}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "h-12 w-10 rounded-xl border bg-surface text-center font-mono text-lg font-semibold text-content outline-none transition sm:h-14 sm:w-11",
            error ? "border-error" : "border-line focus:border-primary focus:shadow-[0_0_8px_rgb(37_99_235/0.3)]",
            disabled && "opacity-50",
          )}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
        />
      ))}
    </div>
  );
}
