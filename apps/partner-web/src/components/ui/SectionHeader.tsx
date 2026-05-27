import Link from "next/link";
import { cn } from "@/lib/cn";
import { partnerLayout } from "@/lib/partner-layout";

type SectionHeaderProps = {
  title: string;
  href?: string;
  linkLabel?: string;
  action?: React.ReactNode;
  className?: string;
};

export function SectionHeader({
  title,
  href,
  linkLabel = "View all",
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn(partnerLayout.sectionHeader, className)}>
      <h2 className={partnerLayout.sectionTitle}>{title}</h2>
      {action}
      {href && !action && (
        <Link href={href} className={partnerLayout.sectionLink}>
          {linkLabel}
        </Link>
      )}
    </div>
  );
}
