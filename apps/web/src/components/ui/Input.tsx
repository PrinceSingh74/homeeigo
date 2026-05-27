"use client";

import {
  forwardRef,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search, Loader2, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shake } from "@/lib/animations";
import { FormLabel, FormMessage, useFieldIds } from "@/components/ui/form-field";

export type InputVariant = "default" | "search" | "error" | "success" | "disabled";
export type InputSize = "sm" | "md" | "lg" | "xl";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  helperText?: string;
  errorMessage?: string;
  successMessage?: string;
  variant?: InputVariant;
  size?: InputSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  isLoading?: boolean;
  isRequired?: boolean;
  characterCount?: boolean;
  maxCharacters?: number;
  showClear?: boolean;
  /** Styles for the bordered input container */
  containerClassName?: string;
  /** Styles for the native `<input>` element */
  inputClassName?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const sizeClasses: Record<InputSize, string> = {
  sm: "h-8 min-h-[44px] px-3 text-sm sm:min-h-8 sm:h-8",
  md: "h-10 min-h-[44px] px-3.5 text-base sm:min-h-10 sm:h-10 sm:text-[15px]",
  lg: "h-12 min-h-[44px] px-4 text-base",
  xl: "h-14 min-h-[44px] px-4 text-base",
};

function resolveVariant(
  variant: InputVariant | undefined,
  props: Pick<InputProps, "disabled" | "errorMessage" | "successMessage">,
): InputVariant {
  if (props.disabled || variant === "disabled") return "disabled";
  if (props.errorMessage || variant === "error") return "error";
  if (props.successMessage || variant === "success") return "success";
  return variant ?? "default";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      errorMessage,
      successMessage,
      variant: variantProp,
      size = "md",
      iconLeft,
      iconRight,
      isLoading,
      isRequired,
      characterCount,
      maxCharacters,
      showClear = true,
      containerClassName,
      inputClassName,
      className,
      id: idProp,
      disabled,
      value,
      defaultValue,
      onChange,
      onFocus,
      onBlur,
      type = "text",
      ...props
    },
    ref,
  ) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const reduced = useReducedMotion();
    const [focused, setFocused] = useState(false);
    const [internal, setInternal] = useState(
      () => (defaultValue?.toString() ?? "") as string,
    );
    const ids = useFieldIds(idProp);
    const resolved = resolveVariant(variantProp, {
      disabled,
      errorMessage,
      successMessage,
    });
    const isControlled = value !== undefined;
    const current = isControlled ? String(value ?? "") : internal;
    const isSearch = resolved === "search" || variantProp === "search";
    const showCount = characterCount && maxCharacters != null;

    const describedBy = [
      helperText ? ids.helperId : null,
      errorMessage ? ids.errorId : null,
      successMessage ? ids.successId : null,
      showCount ? `${ids.id}-count` : null,
    ]
      .filter(Boolean)
      .join(" ");

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

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (!isControlled) setInternal(e.target.value);
      onChange?.(e);
    }

    const trailing =
      isLoading ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden />
      ) : resolved === "success" ? (
        <motion.span
          initial={reduced ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 12 }}
        >
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        </motion.span>
      ) : showClear &&
        !iconRight &&
        current &&
        !disabled &&
        type !== "password" ? (
        <button
          type="button"
          aria-label="Clear input"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-content"
          onClick={() => {
            if (!isControlled) setInternal("");
            const el = inputRef.current;
            if (el) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }}
        >
          <X className="size-4" />
        </button>
      ) : (
        iconRight
      );

    const leading =
      iconLeft ?? (isSearch ? <Search className="size-4 shrink-0 text-muted" aria-hidden /> : null);
    const leadingDecorative = isSearch && !iconLeft;

    return (
      <div className={cn("w-full", className)}>
        {label ? (
          <FormLabel id={ids.id} isRequired={isRequired}>
            {label}
          </FormLabel>
        ) : null}

        <motion.div
          className="relative"
          animate={
            resolved === "error" && !reduced ? "animate" : undefined
          }
          variants={shake}
        >
          <motion.div
            className={cn(
              "relative flex items-center gap-2 rounded-lg border bg-surface transition-[border-color,box-shadow,background-color] duration-200",
              sizeClasses[size],
              borderClass,
              focusGlow,
              resolved === "disabled" && "cursor-not-allowed opacity-50",
              focused && resolved !== "disabled" && "bg-[color-mix(in_srgb,var(--surface)_92%,var(--color-primary)_8%)]",
              containerClassName,
            )}
            animate={
              focused && !reduced && resolved !== "disabled"
                ? { scale: 1.01 }
                : { scale: 1 }
            }
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {leading ? (
              <span
                className={cn(
                  "flex shrink-0 pl-0.5",
                  leadingDecorative ? "pointer-events-none text-muted" : "items-center",
                )}
              >
                {leading}
              </span>
            ) : null}

            <input
              ref={(el) => {
                inputRef.current = el;
                if (typeof ref === "function") ref(el);
                else if (ref) ref.current = el;
              }}
              id={ids.id}
              type={type}
              disabled={disabled || resolved === "disabled"}
              required={isRequired}
              aria-invalid={resolved === "error" || undefined}
              aria-describedby={describedBy || undefined}
              aria-required={isRequired || undefined}
              value={isControlled ? value : undefined}
              defaultValue={isControlled ? undefined : defaultValue}
              onChange={handleChange}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-content outline-none placeholder:text-muted",
                "disabled:cursor-not-allowed",
                inputClassName,
              )}
              onFocus={() => {
                setFocused(true);
                onFocus?.();
              }}
              onBlur={() => {
                setFocused(false);
                onBlur?.();
              }}
              maxLength={maxCharacters}
              {...props}
            />

            {trailing ? (
              <span className="flex shrink-0 items-center pr-0.5">{trailing}</span>
            ) : null}
          </motion.div>
        </motion.div>

        <AnimatePresence mode="wait">
          {errorMessage ? (
            <FormMessage key="err" id={ids.errorId} tone="error">
              {errorMessage}
            </FormMessage>
          ) : successMessage ? (
            <FormMessage key="ok" id={ids.successId} tone="success">
              {successMessage}
            </FormMessage>
          ) : helperText ? (
            <FormMessage key="help" id={ids.helperId} tone="helper">
              {helperText}
            </FormMessage>
          ) : null}
        </AnimatePresence>

        {showCount ? (
          <p
            id={`${ids.id}-count`}
            className={cn(
              "mt-1 text-right text-xs",
              current.length >= maxCharacters!
                ? "text-error"
                : current.length >= maxCharacters! * 0.8
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
Input.displayName = "Input";
