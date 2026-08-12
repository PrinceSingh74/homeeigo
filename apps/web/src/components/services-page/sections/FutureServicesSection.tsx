"use client";

import { useState } from "react";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bell, Lock } from "lucide-react";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { FUTURE_SERVICES } from "@/lib/services-marketplace-data";
import { SERVICES_IMAGE_QUALITY, servicesSection } from "@/components/services-page/services-page-layout";

export function FutureServicesSection() {
  const [email, setEmail] = useState("");
  const nav = useServicesNavigation();
  const reduceMotion = useReducedMotion();

  const handleNotify = () => {
    if (!email.trim()) {
      nav.showToast("Enter your email to get notified", "info");
      return;
    }
    nav.showToast("You're on the list! We'll notify you when we launch.", "success");
    setEmail("");
  };

  return (
    <section
      id="coming-soon"
      className={servicesSection(
        "relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 py-16 sm:py-20 lg:py-24",
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-10" aria-hidden>
        <div className="absolute top-1/2 left-1/4 size-80 rounded-full bg-emerald-500 blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 size-80 rounded-full bg-blue-500 blur-3xl" />
      </div>

      <div className="relative z-10">
        <div className="mb-12 text-center sm:mb-16">
          <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold text-white">
            Coming Soon
          </h2>
          <p className="mt-3 text-base text-gray-300 sm:text-lg">
            Exciting new services launching soon
          </p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-3 sm:mb-16">
          {FUTURE_SERVICES.map((service, i) => (
            <motion.div
              key={service.id}
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.45 }}
              className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 transition-colors hover:border-emerald-500/60"
            >
              <div className="relative h-40 overflow-hidden">
                <Image
                  src={service.image}
                  alt=""
                  fill
                  quality={SERVICES_IMAGE_QUALITY}
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover opacity-60 transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
              </div>

              <div className="relative p-6 sm:p-8">
                <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
                  <Lock className="size-3" aria-hidden />
                  Coming Soon
                </div>

                <span className="text-4xl" aria-hidden>{service.icon}</span>
                <h3 className="mt-3 text-xl font-bold text-white">{service.name}</h3>
                <p className="mt-1 text-sm text-gray-400">{service.description}</p>

                <ul className="mt-5 space-y-2">
                  {service.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => nav.showToast("We'll notify you when this launches!", "success")}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/20 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30"
                >
                  <Bell className="size-4" aria-hidden />
                  Notify Me
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-2xl rounded-2xl border border-emerald-500/50 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 p-6 text-center sm:p-8"
        >
          <h3 className="text-xl font-bold text-white sm:text-2xl">Get Early Access</h3>
          <p className="mt-2 text-sm text-gray-300 sm:text-base">
            Be the first to know when new services launch
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleNotify}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 font-bold text-white transition-colors hover:bg-emerald-600"
            >
              Notify
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
