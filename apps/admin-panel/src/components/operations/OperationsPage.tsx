import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Icon3DTone } from "@/components/hq/Icon3D";
import { PageShell } from "@/components/ui/PageShell";
import { OperationsWorkspaceRail } from "./OperationsWorkspaceRail";
import { cn } from "@/lib/cn";

export function OperationsPage({
  title,
  subtitle,
  icon,
  iconTone = "default",
  actions,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconTone?: Icon3DTone;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageShell
      eyebrow="Operations HQ"
      icon={icon}
      iconTone={iconTone}
      title={title}
      subtitle={subtitle}
      actions={actions}
      className={cn("space-y-8", className)}
    >
      <OperationsWorkspaceRail />
      {children}
    </PageShell>
  );
}
