import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D } from "@/components/hq/Icon3D";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("biz-empty", className)}>
      <Icon3D icon={Icon} size="md" tone="default" />
      <p className="mt-3 text-sm font-semibold text-[var(--color-biz-text)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-[var(--color-biz-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
