"use client";

import { motion } from "framer-motion";
import {
  Sparkles,
  AirVent,
  Wrench,
  Zap,
  Bug,
  Scissors,
  WashingMachine,
  LayoutGrid,
} from "lucide-react";
import { ServiceCard } from "@/components/cards/ServiceCard";

const SERVICES = [
  { icon: Sparkles, name: "Cleaning", price: "₹299", color: "#7C3AED", featured: true },
  { icon: AirVent, name: "AC Repair", price: "₹499", color: "#06B6D4" },
  { icon: Wrench, name: "Plumbing", price: "₹199", color: "#3B82F6" },
  { icon: Zap, name: "Electrician", price: "₹249", color: "#F59E0B" },
  { icon: Bug, name: "Pest Control", price: "₹599", color: "#10B981" },
  { icon: Scissors, name: "Salon", price: "₹399", color: "#EC4899" },
  { icon: WashingMachine, name: "Appliance", price: "₹349", color: "#2563EB" },
  { icon: LayoutGrid, name: "More", price: "₹149", color: "#64748B" },
];

export function ServiceCategories() {
  return (
    <section className="mx-auto mt-14 max-w-content px-5 sm:px-8">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        className="mb-6 font-display text-2xl font-bold text-content sm:text-3xl"
      >
        Popular Services
      </motion.h2>

      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
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
