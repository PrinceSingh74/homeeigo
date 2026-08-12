"use client";

import { m as motion } from "framer-motion";
import { Shield } from "lucide-react";
import { ServicesSectionHeader } from "@/components/services-page/ServicesSectionHeader";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  servicesSection,
  svcCardPremium,
} from "@/components/services-page/services-page-layout";
import { TRUST_ITEMS } from "@/lib/services-page-data";
import { cn } from "@/lib/utils";

export function ServicesTrustSection() {
  const nav = useServicesNavigation();

  const onTrustItem = (title: string) => {
    switch (title) {
      case "Verified Professionals":
        nav.openProfile();
        break;
      case "Secure & Safe":
        nav.openWallet();
        break;
      case "AI-Powered Matching":
        nav.openAiRecommendations();
        break;
      case "On-time Service":
        nav.openBookingsWithTracking();
        break;
      case "24/7 Support":
        nav.openSupport();
        break;
      default:
        nav.openHowItWorks();
    }
  };

  return (
    <section className={servicesSection()}>
      <ServicesSectionHeader
        title="Why Choose HOMEEIGO"
        subtitle="Built for trust — every booking is secure, verified, and backed by our promise."
        onViewAll={nav.openHowItWorks}
        linkLabel="Learn More"
        icon={Shield}
      />
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-5 lg:gap-5">
        {TRUST_ITEMS.map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.button
              key={item.title}
              type="button"
              onClick={() => onTrustItem(item.title)}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06, duration: 0.4 }}
              className={cn(
                svcCardPremium,
                "flex min-w-0 flex-col items-center gap-2.5 border border-[#E5E7EB] bg-white p-4 text-center transition hover:border-primary/40 hover:shadow-md sm:gap-3 sm:p-5 lg:p-6 dark:border-line dark:bg-surface",
              )}
            >
              <span
                className="grid size-11 place-items-center rounded-xl ring-4 ring-white dark:ring-slate-800 sm:size-12"
                style={{ backgroundColor: item.iconBg }}
              >
                <Icon
                  size={22}
                  className="sm:hidden"
                  style={{ color: item.iconColor }}
                  aria-hidden
                />
                <Icon
                  size={24}
                  className="hidden sm:block"
                  style={{ color: item.iconColor }}
                  aria-hidden
                />
              </span>
              <h3 className="font-display text-xs font-bold tracking-[-0.02em] text-content sm:text-sm">
                {item.title}
              </h3>
              <p className="text-[11px] leading-[1.45] text-muted sm:text-xs sm:leading-[1.4]">
                {item.description}
              </p>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
