"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
} from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormMessage } from "@/components/ui/form-field";

export type CheckboxVariant = "default" | "error" | "success" | "disabled";
export type CheckboxSize = "sm" | "md" | "lg";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
  helperText?: string;
  isIndeterminate?: boolean;
  variant?: CheckboxVariant;
  size?: CheckboxSize;
}

const boxSizes: Record<CheckboxSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

const touchSizes: Record<CheckboxSize, string> = {
  sm: "min-h-[44px] min-w-[44px]",
  md: "min-h-[44px] min-w-[44px]",
  lg: "min-h-[44px] min-w-[44px]",
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      helperText,
      isIndeterminate = false,
      variant: variantProp,
      size = "md",
      className,
      disabled,
      id: idProp,
      checked,
      defaultChecked,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    const innerRef = useRef<HTMLInputElement | null>(null);
    const resolved =
      disabled || variantProp === "disabled"
        ? "disabled"
        : variantProp === "error"
          ? "error"
          : variantProp ?? "default";

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = isIndeterminate;
    }, [isIndeterminate]);

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <label
          htmlFor={id}
          className={cn(
            "group inline-flex cursor-pointer items-start gap-3",
            resolved === "disabled" && "cursor-not-allowed opacity-50",
          )}
        >
          <span
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              touchSizes[size],
            )}
          >
            <input
              ref={setRefs}
              id={id}
              type="checkbox"
              disabled={disabled || resolved === "disabled"}
              checked={checked}
              defaultChecked={defaultChecked}
              className="peer sr-only"
              aria-invalid={resolved === "error" || undefined}
              {...props}
            />
            <span
              className={cn(
                "pointer-events-none flex items-center justify-center rounded border-2 transition-colors duration-200",
                boxSizes[size],
                "border-line bg-transparent",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas",
                "peer-checked:border-primary peer-checked:bg-primary",
                "peer-checked:[&_svg]:scale-100 peer-checked:[&_svg]:opacity-100",
                "[&_svg]:scale-0 [&_svg]:opacity-0",
                "group-hover:border-primary/50",
                resolved === "error" && "border-error",
              )}
              aria-hidden
            >
              {!isIndeterminate ? (
                <Check className="size-3 text-white transition-all duration-200" strokeWidth={3} />
              ) : (
                <Minus className="size-3 text-white" strokeWidth={3} />
              )}
            </span>
          </span>
          {label ? (
            <span className="pt-0.5 text-sm font-medium text-content">{label}</span>
          ) : null}
        </label>
        {helperText ? <FormMessage tone="helper">{helperText}</FormMessage> : null}
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";
