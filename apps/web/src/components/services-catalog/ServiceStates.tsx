import type { ReactNode } from "react";
import { SearchX, WifiOff } from "lucide-react";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { Button } from "@/components/buttons/Button";
import { cn } from "@/lib/utils";

export function ServiceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface" aria-hidden>
      <StaticSkeleton shimmer className="aspect-[4/3] w-full" />
      <div className="space-y-2.5 p-4">
        <StaticSkeleton className="h-3 w-16 rounded-full" />
        <StaticSkeleton className="h-5 w-3/4 rounded-md" />
        <StaticSkeleton className="h-3.5 w-full rounded-md" />
        <div className="flex items-center justify-between pt-3">
          <StaticSkeleton className="h-4 w-16 rounded-md" />
          <StaticSkeleton className="h-4 w-20 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function ServiceSkeleton({ count = 8, label = "Loading services" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <ServiceCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function ServiceEmptyState({
  title = "No services found",
  body = "Try another category or search term.",
  action,
  icon: Icon = SearchX,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
  icon?: typeof SearchX;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center",
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-canvas text-muted">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="font-display text-lg font-semibold text-content">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function CatalogError({ onRetry }: { onRetry: () => void }) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <ServiceEmptyState
      icon={WifiOff}
      title={offline ? "You're offline" : "We couldn't load services"}
      body={
        offline
          ? "Check your internet connection, then try again."
          : "Something went wrong on our side. Your bookings are not affected — please try again."
      }
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
