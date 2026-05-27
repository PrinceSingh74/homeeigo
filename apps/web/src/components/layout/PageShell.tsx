import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pageShellMain } from "@/lib/page-layout";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

/** Standard max-width shell for standalone app routes (bookings, etc.). */
export function PageShell({ children, className }: PageShellProps) {
  return <main className={cn(pageShellMain, className)}>{children}</main>;
}
