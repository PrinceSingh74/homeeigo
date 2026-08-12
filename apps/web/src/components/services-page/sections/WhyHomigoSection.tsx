"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import { TRUST_POINTS } from "@/lib/services-marketplace-data";
import { servicesSection } from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

const colorMap = {
  emerald: "from-emerald-50 to-emerald-100/50",
  blue: "from-blue-50 to-blue-100/50",
  yellow: "from-yellow-50 to-yellow-100/50",
  amber: "from-amber-50 to-amber-100/50",
  green: "from-green-50 to-green-100/50",
} as const;

export function WhyHomigoSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className={servicesSection("bg-white py-16 sm:py-20 lg:py-24")}>
      <div className="mb-10 text-center sm:mb-16">
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold text-gray-900">
          Why Choose HOMEEIGO?
        </h2>
        <p className="mt-3 text-base text-gray-500 sm:text-lg">
          Trust, quality, and reliability in every service
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {TRUST_POINTS.map((point, i) => {
          const Icon = point.icon;
          return (
            <motion.div
              key={point.title}
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className={cn(
                "rounded-2xl border border-gray-200 bg-gradient-to-br p-6 transition-all duration-300 hover:border-gray-300 hover:shadow-md",
                colorMap[point.color],
              )}
            >
              <Icon className="mb-4 size-8 text-emerald-600" aria-hidden />
              <h3 className="text-lg font-bold text-gray-900">{point.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{point.description}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
