import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { sectionAction } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

type SectionActionLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

/**
 * The ONE section-level action ("View all", "Explore full catalog", …):
 * a text link with a trailing arrow. Always navigation, so always an anchor.
 */
export function SectionActionLink({ href, children, className }: SectionActionLinkProps) {
  return (
    <Link
      href={href}
      className={cn(sectionAction, "group inline-flex items-center gap-1", className)}
    >
      {children}
      <ArrowRight
        size={16}
        aria-hidden
        className="transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}
