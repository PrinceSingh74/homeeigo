"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { shake } from "@/lib/animations";
import { FormLabel, FormMessage, useFieldIds } from "@/components/ui/form-field";

export type TextareaVariant = "default" | "error" | "success" | "disabled";
export type TextareaSize = "sm" | "md" | "lg" | "xl";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  errorMessage?: string;
  successMessage?: string;
  variant?: TextareaVariant;
  size?: TextareaSize;
  isRequired?: boolean;
  showCharacterCount?: boolean;
  maxCharacters?: number;
  autoResize?: boolean;
  containerClassName?: string;
}

const rowHeights: Record<TextareaSize, { rows: number; minH: string }> = {
  sm: { rows: 3, minH: "min-h-[4.5rem]" },
  md: { rows: 5, minH: "min-h-[7.5rem]" },
  lg: { rows: 8, minH: "min-h-[12rem]" },
  xl: { rows: 12, minH: "min-h-[18rem]" },
};

function resolveVariant(
  variant: TextareaVariant | undefined,
  disabled?: boolean,
  errorMessage?: string,
  successMessage?: string,
): TextareaVariant {
  if (disabled || variant === "disabled") return "disabled";
  if (errorMessage || variant === "error") return "error";
  if (successMessage || variant === "success") return "success";
  return variant ?? "default";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      helperText,
      errorMessage,
      successMessage,
      variant: variantProp,
      size = "md",
      isRequired,
      showCharacterCount,
      maxCharacters,
      autoResize = false,
      containerClassName,
      className,
      id: idProp,
      disabled,
      value,
      defaultValue,
      onChange,
      rows: rowsProp,
      ...props
    },
    ref,
  ) => {
    const reduced = useReducedMotion();
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    const [focused, setFocused] = useState(false);
    const [internal, setInternal] = useState(
      () => (defaultValue?.toString() ?? "") as string,
    );
    const ids = useFieldIds(idProp);
    const resolved = resolveVariant(
      variantProp,
      disabled,
      errorMessage,
      successMessage,
    );
    const isControlled = value !== undefined;
    const current = isControlled ? String(value ?? "") : internal;
    const { rows, minH } = rowHeights[size];

    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    useEffect(() => {
      if (!autoResize || !innerRef.current) return;
      const el = innerRef.current;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [autoResize, current]);

    const borderClass =
      resolved === "error"
        ? "border-error"
        : resolved === "success"
          ? "border-success"
          : focused
            ? "border-primary"
            : "border-line";

    const focusGlow =
      focused && resolved !== "error" && resolved !== "disabled"
        ? "shadow-[0_0_8px_rgb(37_99_235/0.3)]"
        : "";

    return (
      <div className={cn("w-full", className)}>
        {label ? (
          <FormLabel id={ids.id} isRequired={isRequired}>
            {label}
          </FormLabel>
        ) : null}

        <motion.div
          variants={shake}
          animate={resolved === "error" && !reduced ? "animate" : undefined}
        >
          <motion.div
            className={cn(
              "rounded-lg border bg-surface transition-[border-color,box-shadow] duration-200",
              borderClass,
              focusGlow,
              resolved === "disabled" && "opacity-50",
              containerClassName,
            )}
            animate={
              focused && !reduced && resolved !== "disabled"
                ? { scale: 1.01 }
                : { scale: 1 }
            }
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <textarea
              ref={setRefs}
              id={ids.id}
              rows={rowsProp ?? rows}
              disabled={disabled || resolved === "disabled"}
              required={isRequired}
              aria-invalid={resolved === "error" || undefined}
              aria-describedby={
                [
                  helperText && ids.helperId,
                  errorMessage && ids.errorId,
                  successMessage && ids.successId,
                  showCharacterCount && `${ids.id}-count`,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              value={isControlled ? value : undefined}
              defaultValue={isControlled ? undefined : defaultValue}
              maxLength={maxCharacters}
              onChange={(e) => {
                if (!isControlled) setInternal(e.target.value);
                onChange?.(e);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className={cn(
                "w-full resize-y bg-transparent px-3.5 py-3 text-base text-content outline-none placeholder:text-muted sm:text-[15px]",
                minH,
                "min-h-[44px] disabled:cursor-not-allowed",
                autoResize && "resize-none overflow-hidden",
              )}
              {...props}
            />
          </motion.div>
        </motion.div>

        {errorMessage ? (
          <FormMessage id={ids.errorId} tone="error">
            {errorMessage}
          </FormMessage>
        ) : successMessage ? (
          <FormMessage id={ids.successId} tone="success">
            {successMessage}
          </FormMessage>
        ) : helperText ? (
          <FormMessage id={ids.helperId} tone="helper">
            {helperText}
          </FormMessage>
        ) : null}

        {showCharacterCount && maxCharacters != null ? (
          <p
            id={`${ids.id}-count`}
            className={cn(
              "mt-1 text-right text-xs",
              current.length >= maxCharacters
                ? "text-error"
                : current.length >= maxCharacters * 0.8
                  ? "text-warning"
                  : "text-muted",
            )}
          >
            {current.length} / {maxCharacters}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
