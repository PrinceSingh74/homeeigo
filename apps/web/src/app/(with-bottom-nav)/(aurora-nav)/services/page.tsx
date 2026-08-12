import type { Metadata } from "next";
import { ServicesPage } from "@/components/services-page/ServicesPage";

export const metadata: Metadata = {
  title: "Professional Home Services",
  description:
    "Book trusted home cleaning, maintenance, laundry services in 11+ Indian cities. Background-verified experts, on-time guarantee, 4.9★ rated.",
};

export default function ServicesRoute() {
  return <ServicesPage />;
}
