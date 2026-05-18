"use client";

import { motion } from "framer-motion";
import { Scissors } from "lucide-react";
import { ServiceCard } from "@/components/cards/ServiceCard";

const SERVICES = [
  { img: "/svc-cleaning.png", name: "Cleaning", price: "₹199", color: "#7C3AED", featured: true },
  { img: "/svc-ac.png", name: "AC Service", price: "₹299", color: "#06B6D4" },
  { img: "/svc-plumbing.png", name: "Plumbing", price: "₹249", color: "#3B82F6" },
  { img: "/svc-electrician.png", name: "Electrician", price: "₹249", color: "#F59E0B" },
  { img: "/svc-pest.png", name: "Pest Control", price: "₹299", color: "#10B981" },
  { icon: Scissors, name: "Salon", price: "₹199", color: "#EC4899" },
];

export function ServiceCategories() {
  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        className="mb-10 font-display text-3xl font-bold text-content sm:text-4xl lg:text-5xl"
      >
        Popular Services
      </motion.h2>

      <div
        className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6"
        role="list"
        aria-label="Service categories"
      >
        {SERVICES.map((s, i) => (
          <div role="listitem" key={s.name}>
            <ServiceCard {...s} index={i} />
          </div>
        ))}
      </div>
    </section>
  );
}
