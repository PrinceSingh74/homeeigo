"use client";

import Link from "next/link";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { Clock, Star } from "lucide-react";
import { bookUrl } from "@/lib/booking-url";
import type { MarketplaceService } from "@/lib/services-marketplace-data";
import { SERVICES_IMAGE_QUALITY } from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "premium" | "express" | "outdoor";

type ServiceMarketplaceCardProps = {
  service: MarketplaceService;
  index?: number;
  variant?: CardVariant;
  showFreshness?: boolean;
};

const variantStyles: Record<CardVariant, { card: string; cta: string; price: string }> = {
  default: {
    card: "bg-white border-gray-200 hover:border-emerald-200",
    cta: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    price: "text-gray-900",
  },
  premium: {
    card: "bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700",
    cta: "bg-emerald-500 text-white hover:bg-emerald-600",
    price: "text-emerald-400",
  },
  express: {
    card: "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200",
    cta: "bg-amber-500 text-white hover:bg-amber-600",
    price: "text-amber-600",
  },
  outdoor: {
    card: "bg-white border-emerald-200/50",
    cta: "bg-emerald-600 text-white hover:bg-emerald-700",
    price: "text-gray-900",
  },
};

export function ServiceMarketplaceCard({
  service,
  index = 0,
  variant = "default",
  showFreshness = false,
}: ServiceMarketplaceCardProps) {
  const reduceMotion = useReducedMotion();
  const styles = variantStyles[variant];
  const isDark = variant === "premium";

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduceMotion ? undefined : { y: -8 }}
      className="group"
    >
      <Link
        href={bookUrl({ service: service.serviceId })}
        className={cn(
          "block overflow-hidden rounded-2xl border shadow-sm transition-all duration-300",
          "hover:shadow-xl",
          styles.card,
        )}
      >
        <div className="relative h-48 overflow-hidden bg-gray-100 sm:h-52">
          <Image
            src={service.image}
            alt={service.name}
            fill
            quality={SERVICES_IMAGE_QUALITY}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 280px"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
          {variant === "premium" && (
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent" />
          )}
          {variant === "express" && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
          )}
          {service.badge && (
            <div
              className={cn(
                "absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-semibold text-white",
                variant === "express" ? "bg-amber-500" : "bg-emerald-500",
              )}
            >
              {service.badge}
            </div>
          )}
          {variant === "premium" && (
            <div className="absolute top-3 right-3 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
              Premium
            </div>
          )}
        </div>

        <div className={cn("space-y-3 p-4 sm:p-5", isDark && "border-t border-slate-700")}>
          <h3
            className={cn(
              "font-semibold",
              isDark ? "text-lg text-white" : "text-gray-900",
            )}
          >
            {service.name}
          </h3>

          {showFreshness && service.freshness && (
            <p className="text-sm font-medium text-emerald-600">{service.freshness}</p>
          )}

          <div className="flex items-center justify-between text-sm">
            <span
              className={cn(
                "flex items-center gap-1",
                isDark ? "text-gray-300" : "text-gray-500",
              )}
            >
              <Clock className="size-4" aria-hidden />
              {service.duration}
            </span>
            <span className="flex items-center gap-1">
              <Star
                className="size-4 fill-amber-400 text-amber-400"
                aria-hidden
              />
              <span
                className={cn(
                  "svc-num font-semibold tabular-nums",
                  isDark ? "text-white" : "text-gray-900",
                )}
              >
                {service.rating}
              </span>
            </span>
          </div>

          <div className={cn("pt-2", !isDark && "border-t border-gray-100")}>
            <p
              className={cn(
                "svc-num mb-3 font-bold tabular-nums",
                variant === "premium" ? "text-2xl" : "text-base",
                styles.price,
              )}
            >
              {service.price}
            </p>
            <span
              className={cn(
                "block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors",
                styles.cta,
              )}
            >
              {variant === "premium"
                ? "Book Premium"
                : variant === "express"
                  ? "Book Express Service"
                  : "Book Now"}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
