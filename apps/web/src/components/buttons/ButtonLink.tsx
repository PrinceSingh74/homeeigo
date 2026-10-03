"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  buttonBase,
  buttonSizes,
  buttonVariants,
  type ButtonProps,
} from "./Button";

type ButtonLinkProps = {
  href: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
};

export function ButtonLink({
  href,
  variant = "primary",
  size = "lg",
  fullWidth,
  className,
  children,
  onClick,
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        buttonBase,
        "hover:-translate-y-1 active:scale-[0.98] motion-reduce:transform-none",
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </Link>
  );
}
