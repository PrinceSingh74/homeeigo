import Link from "next/link";
import { cn } from "@/lib/utils";
import { aiRightBlockAction, aiRightBlockTitle } from "@/components/ai/ai-page-layout";

type AiRightPanelBlockHeaderProps = {
  title: string;
  href?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function AiRightPanelBlockHeader({
  title,
  href,
  actionLabel = "View All",
  onAction,
  className,
}: AiRightPanelBlockHeaderProps) {
  const actionClass = aiRightBlockAction;

  return (
    <div className={cn("mb-3 flex min-w-0 items-center justify-between gap-2", className)}>
      <h3 className={cn(aiRightBlockTitle, "min-w-0 truncate")}>{title}</h3>
      {href ? (
        <Link href={href} className={actionClass}>
          {actionLabel}
        </Link>
      ) : onAction ? (
        <button type="button" onClick={onAction} className={actionClass}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
