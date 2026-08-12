"use client";

import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
} from "@/components/services-page/services-page-layout";
import { CTA_ROOM_IMAGE } from "@/lib/services-page-data";
import { cn } from "@/lib/utils";

function CtaParticles() {
  const reduce = useReducedMotion();
  const count = reduce ? 0 : 48;
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${(i * 13) % 100}%`,
    top: `${(i * 19) % 100}%`,
    size: 2 + (i % 5),
    delay: (i % 10) * 1.5,
    duration: 18 + (i % 15),
  }));

  if (particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full bg-white/50"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
          }}
          animate={{ y: [0, -50, 0], opacity: [0.3, 0.85, 0.3] }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export function ServicesCtaSection() {
  const nav = useServicesNavigation();

  return (
    <section className={servicesSection()}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
        className={cn(
          "svc-cta-shell relative min-h-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#EC4899] p-5 text-white sm:rounded-[20px] sm:p-8 md:p-10 lg:p-12",
        )}
      >
        <motion.div
          className="pointer-events-none absolute inset-0 opacity-95"
          animate={{ opacity: [1, 0.95, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
        <CtaParticles />

        <div className="relative grid min-w-0 items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-[60px]">
          <div className="z-10 min-w-0 max-w-lg">
            <h2
              className="font-display font-bold leading-[1.25] tracking-[-0.02em] sm:leading-[1.3]"
              style={{ fontSize: "clamp(1.375rem, 4.5vw, 2.25rem)" }}
            >
              Ready to experience the future of home services?
            </h2>
            <p className="mt-3 text-sm leading-[1.6] text-white/90 sm:mt-4 sm:text-base">
              Book now and get ₹150 OFF on your first service
            </p>
            <button
              type="button"
              onClick={() => nav.bookFirstOffer()}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-[#7C3AED] shadow-[0_8px_24px_rgb(0_0_0/0.15)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgb(0_0_0/0.2)] active:scale-[0.98] sm:mt-6 sm:h-12 sm:w-auto sm:px-7 sm:text-[15px]"
            >
              Book a Service Now
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>

          <div className="relative mx-auto aspect-[3/2] w-full min-w-0 max-w-[450px] lg:mx-0 lg:justify-self-end">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="relative h-full min-h-[160px] w-full sm:min-h-[200px]"
            >
              <Image
                src={CTA_ROOM_IMAGE}
                alt="Premium modern living room"
                fill
                quality={SERVICES_IMAGE_QUALITY}
                sizes="(max-width: 1024px) 90vw, 450px"
                className="svc-cta-room rounded-xl object-cover sm:rounded-2xl"
              />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
