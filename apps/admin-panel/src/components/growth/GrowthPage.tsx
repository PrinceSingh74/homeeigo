import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Icon3DTone } from "@/components/hq/Icon3D";
import { PageShell } from "@/components/ui/PageShell";
import { GrowthWorkspaceRail } from "./GrowthWorkspaceRail";

export function GrowthPage({
  title,
  subtitle,
  icon,
  iconTone = "success",
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconTone?: Icon3DTone;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageShell
      eyebrow="Growth HQ"
      icon={icon}
      iconTone={iconTone}
      title={title}
      subtitle={subtitle}
      actions={actions}
    >
      <GrowthWorkspaceRail />
      {children}
    </PageShell>
  );
}
