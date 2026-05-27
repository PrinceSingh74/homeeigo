"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ServiceCard } from "@/components/cards/ServiceCard";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { sectionAction } from "@/lib/page-layout";

export function ServiceCategories() {
  return (
    <PageSection>
      <SectionHeader
        title="Popular Services"
        action={
          <Link
            href="/services"
            className={cn(sectionAction, "inline-flex items-center gap-1")}
          >
            Explore full catalog
            <ArrowRight size={16} aria-hidden />
          </Link>
        }
      />

      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-6"
        role="list"
        aria-label="Service categories"
      >
        {SERVICES.map((s, i) => (
          <div role="listitem" key={s.id}>
            <ServiceCard
              serviceId={s.id}
              img={s.img}
              icon={s.icon}
              name={s.name}
              price={s.price}
              color={s.color}
              featured={s.featured}
              index={i}
            />
          </div>
        ))}
      </div>
    </PageSection>
  );
}
