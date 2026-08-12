"use client";

import { cn } from "@/lib/utils";
import {
  svcConversionEyebrow,
  svcConversionHeadline,
  svcConversionHeadlineDark,
  svcConversionSubhead,
  svcConversionSubheadDark,
} from "@/components/services-page/services-page-layout";

type ConversionSectionHeaderProps = {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  subtitle: string;
  subtitleSecondary?: string;
  dark?: boolean;
  className?: string;
};

export function ConversionSectionHeader({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  subtitleSecondary,
  dark = false,
  className,
}: ConversionSectionHeaderProps) {
  return (
    <header className={cn("mx-auto mb-14 max-w-3xl text-center sm:mb-16 lg:mb-20", className)}>
      {eyebrow && (
        <p className={cn(svcConversionEyebrow, dark && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")}>
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          dark ? svcConversionHeadlineDark : svcConversionHeadline,
          titleAccent && "mb-0",
        )}
      >
        {title}
        {titleAccent && (
          <span className="mt-2 block text-gradient-brand">{titleAccent}</span>
        )}
      </h2>
      <p className={cn(dark ? svcConversionSubheadDark : svcConversionSubhead)}>
        {subtitle}
        {subtitleSecondary && (
          <span className={cn("mt-2 block", dark ? "text-slate-400" : "text-gray-600")}>
            {subtitleSecondary}
          </span>
        )}
      </p>
    </header>
  );
}
