"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { MapPin, Users } from "lucide-react";
import { CITIES } from "@/lib/services-marketplace-data";
import { useLiveMetrics } from "@/hooks/use-live-metrics";
import { useCoverageCities } from "@/hooks/use-coverage";
import { CoverageSearch } from "@/components/services-page/coverage/CoverageSearch";
import { SERVICES_IMAGE_QUALITY, servicesSection } from "@/components/services-page/services-page-layout";

// Hyperlocal explorer is heavy (tabs, virtualized lists) — load only on first open.
const CityCoverageModal = dynamic(
  () =>
    import("@/components/services-page/coverage/CityCoverageModal").then(
      (m) => m.CityCoverageModal,
    ),
  { ssr: false },
);

const citySlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

export function CitiesSection() {
  const reduceMotion = useReducedMotion();
  const metrics = useLiveMetrics();
  const coverage = useCoverageCities();
  const [openCity, setOpenCity] = useState<{ slug: string; name: string } | null>(null);
  const [modalMounted, setModalMounted] = useState(false);

  const coverageBySlug = useMemo(() => {
    const map = new Map<string, { activePartners: number; status: string }>();
    for (const c of coverage.data?.cities ?? []) {
      map.set(c.slug, { activePartners: c.activePartners, status: c.status });
    }
    return map;
  }, [coverage.data?.cities]);

  const openCoverage = useCallback((name: string) => {
    setModalMounted(true);
    setOpenCity({ slug: citySlug(name), name });
  }, []);

  return (
    <section
      className={servicesSection(
        "relative overflow-hidden bg-gradient-to-br from-slate-900 via-[#1B5E4F]/90 to-slate-900 py-16 sm:py-20 lg:py-24",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1600&q=80&auto=format&fit=crop)",
        }}
        aria-hidden
      />

      <div className="relative z-10">
        <div className="mb-8 text-center sm:mb-10">
          <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold text-white">
            Available in 11+ Indian Cities
          </h2>
          <p className="mt-3 text-base text-gray-300 sm:text-lg">
            Hyperlocal coverage — check your society, area or pincode
          </p>
        </div>

        {/* Level 8 — real-time coverage search */}
        <div className="mb-10 sm:mb-14">
          <CoverageSearch onOpenCity={(slug) => {
            setModalMounted(true);
            const match = CITIES.find((c) => citySlug(c.name) === slug);
            setOpenCity({ slug, name: match?.name ?? slug });
          }} />
        </div>

        <div className="mb-10 grid grid-cols-2 gap-6 sm:mb-16 md:grid-cols-4 md:gap-8">
          {metrics.map((metric, i) => (
            <motion.div
              key={metric.label}
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <p className="svc-num text-3xl font-bold text-emerald-400 sm:text-4xl">
                {metric.number}
              </p>
              <p className="mt-1 text-sm text-gray-300">{metric.label}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {CITIES.map((city, i) => {
            const cov = coverageBySlug.get(citySlug(city.name));
            return (
              <motion.button
                key={city.name}
                type="button"
                onClick={() => openCoverage(city.name)}
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 6) * 0.05 }}
                whileHover={reduceMotion ? undefined : { y: -8 }}
                aria-label={`Explore ${city.name} service coverage`}
                className="group relative h-28 cursor-pointer overflow-hidden rounded-xl text-left sm:h-32"
              >
                <Image
                  src={city.image}
                  alt={city.name}
                  fill
                  quality={SERVICES_IMAGE_QUALITY}
                  sizes="(max-width: 640px) 50vw, 160px"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-black/20 transition-all duration-300 group-hover:from-black/90" />
                <div className="absolute inset-0 flex flex-col items-center justify-end gap-0.5 pb-3">
                  <span className="text-center text-sm font-bold text-white">{city.name}</span>
                  {cov && cov.activePartners > 0 ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300">
                      <Users size={10} /> {cov.activePartners}+ partners
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300 opacity-0 transition group-hover:opacity-100">
                      <MapPin size={10} /> View coverage
                    </span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Tap a city to explore areas, pincodes, societies and live availability
        </p>
      </div>

      {modalMounted && (
        <CityCoverageModal
          citySlug={openCity?.slug ?? null}
          cityName={openCity?.name}
          onClose={() => setOpenCity(null)}
        />
      )}
    </section>
  );
}
