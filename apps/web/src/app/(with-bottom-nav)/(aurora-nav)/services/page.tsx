import type { Metadata } from "next";
import { ServicesPage } from "@/components/services-page/ServicesPage";

export const metadata: Metadata = {
  title: "Services — HOMIGO",
  description:
    "Discover premium home services — cleaning, AC, plumbing, and more. AI recommendations and instant booking.",
};

export default function ServicesRoute() {
  return <ServicesPage />;
}
