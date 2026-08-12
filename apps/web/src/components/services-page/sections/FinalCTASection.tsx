"use client";

import { memo } from "react";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { FINAL_CTA_TRUST_BAR } from "@/lib/services-marketplace-data";
import { CTA_ROOM_IMAGE } from "@/lib/services-page-data";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
} from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

export const FinalCTASection = memo(function FinalCTASection() {
  const nav = useServicesNavigation();
  const reduceMotion = useReducedMotion();

  return (
    <section
      className={cn(
        servicesSection(),
        "relative !max-w-none overflow-hidden !px-0",
      )}
    >
      <div className="relative min-h-[520px] overflow-hidden sm:min-h-[580px] lg:min-h-[620px]">
        <Image
          src={CTA_ROOM_IMAGE}
          alt=""
          fill
          priority={false}
          quality={SERVICES_IMAGE_QUALITY}
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-[#071f1a]/96 via-[#1B5E4F]/90 to-emerald-950/85"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10"
          aria-hidden
        />

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col items-center justify-center px-[var(--svc-page-pad)] py-20 text-center sm:py-24 lg:py-28"
        >
          <p className="mb-5 inline-flex items-center rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100 backdrop-blur-sm">
            Start Today
          </p>

          <h2 className="svc-cta-headline-shadow font-display text-[clamp(2rem,5.5vw,3.5rem)] font-bold leading-[1.06] tracking-[-0.035em] text-white">
            Ready to Experience HOMEEIGO?
          </h2>

          <p className="svc-cta-body-shadow mx-auto mt-6 max-w-2xl text-[17px] font-medium leading-[1.7] text-white/95 sm:mt-7 sm:text-xl sm:leading-[1.75]">
            Book trusted home services in minutes.
            <span className="mt-2 block text-emerald-50/95">
              Enjoy a cleaner, healthier, stress-free home.
            </span>
          </p>

          <div className="mt-10 flex w-full max-w-lg flex-col justify-center gap-4 sm:mt-12 sm:max-w-none sm:flex-row sm:gap-5">
            <button
              type="button"
              onClick={() => nav.book()}
              className="inline-flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-white px-10 text-[17px] font-bold text-[#1B5E4F] shadow-[0_16px_48px_-12px_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-0.5 hover:bg-gray-50 active:scale-[0.99]"
            >
              Book Service
              <ArrowRight className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => nav.openPremium()}
              className="inline-flex min-h-[56px] items-center justify-center rounded-2xl border-2 border-white/40 bg-white/12 px-10 text-[17px] font-bold text-white backdrop-blur-md transition-colors hover:bg-white/18 active:scale-[0.99]"
            >
              Explore Membership
            </button>
          </div>

          <div className="mt-12 w-full max-w-5xl rounded-[20px] border border-white/20 bg-black/25 p-6 backdrop-blur-lg sm:mt-14 sm:p-8">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center lg:justify-center lg:gap-x-10 lg:gap-y-4">
              {FINAL_CTA_TRUST_BAR.map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="inline-flex items-center justify-center gap-2.5 text-sm font-bold text-white sm:text-[15px]"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
});
