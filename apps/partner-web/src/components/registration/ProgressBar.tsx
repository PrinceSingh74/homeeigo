"use client";

type StepItem = {
  number: number;
  label: string;
};

export function RegistrationProgressBar({
  steps,
  currentStep,
}: {
  steps: StepItem[];
  currentStep: number;
}) {
  return (
    <nav aria-label="Registration progress" className="mb-8">
      <ol className="flex items-center justify-between gap-2">
        {steps.map((step, index) => {
          const done = currentStep > step.number;
          const active = currentStep === step.number;
          return (
            <li key={step.number} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                {index > 0 ? (
                  <div
                    className={`h-0.5 flex-1 ${done || active ? "bg-partner-primary" : "bg-[var(--color-partner-border)]"}`}
                  />
                ) : (
                  <div className="flex-1" />
                )}
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done
                      ? "bg-partner-primary text-white"
                      : active
                        ? "border-2 border-partner-primary text-partner-primary"
                        : "border border-[var(--color-partner-border)] text-[var(--color-partner-muted)]"
                  }`}
                >
                  {done ? "✓" : step.number}
                </span>
                {index < steps.length - 1 ? (
                  <div
                    className={`h-0.5 flex-1 ${done ? "bg-partner-primary" : "bg-[var(--color-partner-border)]"}`}
                  />
                ) : (
                  <div className="flex-1" />
                )}
              </div>
              <span
                className={`text-center text-[10px] font-medium sm:text-xs ${
                  active ? "text-partner-primary" : "text-[var(--color-partner-muted)]"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
