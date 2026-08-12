"use client";

import Link from "next/link";
import { m as motion } from "framer-motion";
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
  children: React.ReactNode;
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
    <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
      <Link
        href={href}
        onClick={onClick}
        className={cn(
          buttonBase,
          "disabled:pointer-events-none disabled:opacity-50",
          "transition-shadow",
          buttonVariants[variant],
          buttonSizes[size],
          fullWidth && "w-full",
          className,
        )}
      >
        {children}
      </Link>
    </motion.div>
  );
}
