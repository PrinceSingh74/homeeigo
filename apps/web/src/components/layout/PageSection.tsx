import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pageSection, pageSectionGap } from "@/lib/page-layout";

type PageSectionProps = {
  children: ReactNode;
  className?: string;
  /** Apply standard top margin between homepage sections */
  spaced?: boolean;
  id?: string;
};

/** Max-width content shell with safe-area horizontal padding. */
export function PageSection({
  children,
  className,
  spaced = true,
  id,
}: PageSectionProps) {
  return (
    <section
      id={id}
      className={cn(pageSection, spaced && pageSectionGap, className)}
    >
      {children}
    </section>
  );
}
