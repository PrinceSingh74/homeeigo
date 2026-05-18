"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";

const ITEMS = [
  {
    title: "Sofa Deep Clean",
    price: "₹699",
    rating: "4.9",
    img: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=75",
  },
  {
    title: "AC Gas Refill",
    price: "₹1,299",
    rating: "4.8",
    img: "https://images.unsplash.com/photo-1635048424329-a9bfb146d7aa?w=600&q=75",
  },
  {
    title: "Kitchen Cleaning",
    price: "₹499",
    rating: "4.7",
    img: "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=600&q=75",
  },
  {
    title: "Bathroom Cleaning",
    price: "₹599",
    rating: "4.8",
    img: "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=600&q=75",
  },
];

export function RecommendedSection() {
  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <div className="mb-10 flex items-center justify-between">
        <h2 className="font-display text-3xl font-bold text-content sm:text-4xl lg:text-5xl">
          Recommended for You
        </h2>
        <button
          type="button"
          className="text-base font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
        >
          See all
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {ITEMS.map((it, i) => (
          <motion.button
            type="button"
            key={it.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.08 }}
            whileHover={{ y: -6 }}
            className="group overflow-hidden rounded-3xl border border-line bg-surface text-left shadow-e3 outline-none transition-shadow hover:shadow-e4 focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <div className="relative h-56 w-full overflow-hidden bg-line/40 sm:h-64">
              <img
                src={it.img}
                alt={it.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
            </div>
            <div className="p-6">
              <p className="truncate font-display text-lg font-semibold text-content">
                {it.title}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-display text-2xl font-bold text-primary">
                  {it.price}
                </span>
                <span className="flex items-center gap-1 text-base font-medium text-muted">
                  <Star size={16} className="fill-warning text-warning" />
                  {it.rating}
                </span>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
