"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import { HOW_IT_WORKS_STEPS } from "@/lib/services-marketplace-data";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function HowItWorksSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className={servicesSection("bg-white py-16 sm:py-20 lg:py-24")}>
      <div className="mb-10 text-center sm:mb-16">
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold text-gray-900">
          How HOMEEIGO Works
        </h2>
        <p className="mt-3 text-base text-gray-500 sm:text-lg">
          5 simple steps to get your home sorted
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {HOW_IT_WORKS_STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.number}
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.45 }}
              className="relative"
            >
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 text-center sm:p-8">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-[#1B5E4F] text-xl font-bold text-white">
                  {step.number}
                </div>
                <Icon className="mx-auto mb-4 size-8 text-emerald-600" aria-hidden />
                <h3 className="text-base font-bold text-gray-900 sm:text-lg">{step.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{step.description}</p>
              </div>

              {i < HOW_IT_WORKS_STEPS.length - 1 && (
                <div
                  className="absolute top-1/2 -right-2 hidden -translate-y-1/2 text-emerald-600 lg:block"
                  aria-hidden
                >
                  →
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
