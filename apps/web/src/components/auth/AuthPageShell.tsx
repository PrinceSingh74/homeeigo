"use client";

import Image from "next/image";
import Link from "next/link";
import { m as motion, useReducedMotion } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/cards/Card";
import { fadeUpShow } from "@/lib/animations";
import { pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

type AuthPageShellProps = {
  title: string;
  subtitle: string;
  badge?: string;
  backHref?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthPageShell({
  title,
  subtitle,
  badge = "Secure sign-in",
  backHref = "/",
  children,
  footer,
}: AuthPageShellProps) {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AuroraBackground />
      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col items-center justify-center py-10 sm:py-14",
          pagePadX,
        )}
      >
        <motion.div
          className="w-full max-w-md"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link
            href={backHref}
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted transition hover:text-primary"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to Homeeigo
          </Link>

          <div className="mb-8 text-center">
            {/* Light artwork on light UI; light-wordmark variant in night mode. */}
            <Image
              src="/brand/logo-full.png"
              alt="Homeeigo"
              width={560}
              height={386}
              priority
              className="mx-auto mb-6 h-[124px] w-[180px] object-contain dark:hidden"
            />
            <Image
              src="/brand/logo-full-dark.png"
              alt="Homeeigo"
              width={560}
              height={386}
              priority
              className="mx-auto mb-6 hidden h-[124px] w-[180px] object-contain dark:block"
            />
            <motion.div variants={fadeUpShow} custom={0} initial={false} animate="show">
              <Badge variant="ai" className="mb-4">
                <Sparkles size={14} aria-hidden />
                {badge}
              </Badge>
            </motion.div>
            <h1 className="font-display text-[clamp(1.75rem,4.5vw,2.25rem)] font-bold tracking-tight text-content">
              {title}
            </h1>
            <p className="mt-2 text-base leading-relaxed text-muted sm:text-lg">{subtitle}</p>
          </div>

          <Card variant="default" className="p-5 sm:p-8">
            {children}
          </Card>

          {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
        </motion.div>
      </div>
    </div>
  );
}
