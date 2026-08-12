"use client";

import { cn } from "@/lib/utils";
import { useUnreadNotificationCount } from "@/hooks/use-core-data";

type NotificationBadgeProps = {
  className?: string;
  size?: "sm" | "md";
};

export function NotificationBadge({ className, size = "md" }: NotificationBadgeProps) {
  const unread = useUnreadNotificationCount();
  if (unread <= 0) return null;

  return (
    <span
      className={cn(
        "absolute grid place-items-center rounded-full bg-pink font-bold text-white ring-2 ring-surface",
        size === "sm"
          ? "right-1 top-1 size-3.5 text-[9px]"
          : "right-1.5 top-1.5 min-w-[18px] px-1 text-[10px]",
        className,
      )}
    >
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
