import type { Metadata } from "next";
import { ServicesHub } from "@/components/services-catalog/ServicesHub";

export const dynamic = "force-static";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "All Services — Home Help, Cleaning, Repairs, Beauty & Care",
  description:
    "Everything your home needs in one trusted place. Browse home help, cleaning, maintenance, appliance care, beauty and more — with clear pricing and what's included, before you book.",
  alternates: { canonical: "/services" },
};

export default function ServicesRoute() {
  // Do not await the catalog on this route. Waiting here held the RSC flight
  // (~2.7s) so the previous page stayed on screen. ServicesHub fetches live
  // data on the client (useCatalog) and already has a skeleton for that gap.
  return <ServicesHub initialServices={null} />;
}
