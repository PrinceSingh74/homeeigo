"use client";

import { useId, type InputHTMLAttributes } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { FormMessage } from "@/components/ui/form-field";

export type RadioVariant = "default" | "error" | "success" | "disabled";
export type RadioSize = "sm" | "md" | "lg";

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
  helperText?: string;
  variant?: RadioVariant;
  size?: RadioSize;
}

const dotSizes: Record<RadioSize, string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

const ringSizes: Record<RadioSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export function Radio({
  label,
  helperText,
  variant: variantProp,
  size = "md",
  className,
  disabled,
  id: idProp,
  ...props
}: RadioProps) {
  const reduced = useReducedMotion();
  const autoId = useId();
  const id = idProp ?? autoId;
  const resolved =
    disabled || variantProp === "disabled"
      ? "disabled"
      : variantProp === "error"
        ? "error"
        : variantProp ?? "default";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className={cn(
          "group inline-flex min-h-[44px] cursor-pointer items-center gap-3",
          resolved === "disabled" && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          <input
            id={id}
            type="radio"
            disabled={disabled || resolved === "disabled"}
            className="peer sr-only"
            aria-invalid={resolved === "error" || undefined}
            {...props}
          />
          <span
            className={cn(
              "flex items-center justify-center rounded-full border-2 border-line transition-colors duration-200",
              ringSizes[size],
              "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas",
              "peer-checked:border-primary group-hover:border-primary/50",
              resolved === "error" && "border-error",
            )}
            aria-hidden
          >
            <span
              className={cn(
                "rounded-full bg-primary opacity-0 transition-all duration-200",
                "scale-0 peer-checked:scale-[0.6] peer-checked:opacity-100",
                dotSizes[size],
                reduced && "transition-none",
              )}
            />
          </span>
        </span>
        <span className="flex min-w-0 flex-col">
          {label ? (
            <span className="text-sm font-medium text-content">{label}</span>
          ) : null}
          {helperText ? (
            <span className="text-xs text-muted">{helperText}</span>
          ) : null}
        </span>
      </label>
    </div>
  );
}

export interface RadioGroupOption {
  value: string;
  label: string;
  helperText?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  options: RadioGroupOption[];
  value?: string;
  onChange?: (value: string) => void;
  variant?: "default" | "error";
  disabled?: boolean;
  className?: string;
  legend?: string;
}

export function RadioGroup({
  name,
  options,
  value,
  onChange,
  variant = "default",
  disabled,
  className,
  legend,
}: RadioGroupProps) {
  const groupId = useId();

  return (
    <fieldset
      className={cn("space-y-2 border-0 p-0", className)}
      aria-invalid={variant === "error" || undefined}
    >
      {legend ? (
        <legend className="mb-2 text-sm font-medium text-content">{legend}</legend>
      ) : null}
      <div role="radiogroup" aria-labelledby={legend ? `${groupId}-legend` : undefined}>
        {options.map((opt) => (
          <Radio
            key={opt.value}
            name={name}
            value={opt.value}
            label={opt.label}
            helperText={opt.helperText}
            checked={value === opt.value}
            disabled={disabled || opt.disabled}
            variant={variant === "error" ? "error" : disabled ? "disabled" : "default"}
            onChange={() => onChange?.(opt.value)}
          />
        ))}
      </div>
      {variant === "error" ? (
        <FormMessage tone="error">Please select an option</FormMessage>
      ) : null}
    </fieldset>
  );
}
