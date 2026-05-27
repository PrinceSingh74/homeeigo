import { PartnerCard } from "@/components/ui/PartnerCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

type DashboardPanelProps = {
  title: string;
  href?: string;
  linkLabel?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  compact?: boolean;
  hover?: boolean;
};

export function DashboardPanel({
  title,
  href,
  linkLabel,
  action,
  children,
  className,
  bodyClassName,
  compact,
  hover = false,
}: DashboardPanelProps) {
  return (
    <PartnerCard
      hover={hover}
      padded={false}
      className={cn(
        partnerLayout.cardRadius,
        compact ? partnerLayout.cardPadCompact : partnerLayout.cardPad,
        "flex h-full flex-col",
        className
      )}
    >
      <SectionHeader title={title} href={href} linkLabel={linkLabel} action={action} />
      <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </PartnerCard>
  );
}
