import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("biz-field", className)}>
      <span className="biz-field__label">{label}</span>
      {children}
      {hint ? <span className="biz-field__hint">{hint}</span> : null}
    </label>
  );
}
