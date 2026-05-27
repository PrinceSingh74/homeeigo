"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function useFieldIds(providedId?: string) {
  const auto = useId();
  const id = providedId ?? auto;
  return {
    id,
    labelId: `${id}-label`,
    helperId: `${id}-helper`,
    errorId: `${id}-error`,
    successId: `${id}-success`,
  };
}

type FormLabelProps = {
  id: string;
  children: ReactNode;
  isRequired?: boolean;
  className?: string;
};

export function FormLabel({ id, children, isRequired, className }: FormLabelProps) {
  return (
    <label
      id={`${id}-label`}
      htmlFor={id}
      className={cn(
        "mb-1.5 block text-sm font-medium text-content",
        className,
      )}
    >
      {children}
      {isRequired ? (
        <span className="ml-0.5 text-error" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
}

type FormMessageProps = {
  id?: string;
  tone?: "helper" | "error" | "success";
  children: ReactNode;
  className?: string;
};

export function FormMessage({ id, tone = "helper", children, className }: FormMessageProps) {
  const toneClass =
    tone === "error"
      ? "text-error"
      : tone === "success"
        ? "text-success"
        : "text-muted";

  return (
    <p id={id} role={tone === "error" ? "alert" : undefined} className={cn("mt-1.5 text-xs", toneClass, className)}>
      {children}
    </p>
  );
}
