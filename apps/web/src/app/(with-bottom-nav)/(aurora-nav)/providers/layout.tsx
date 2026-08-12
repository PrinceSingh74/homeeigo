import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trusted Home Service Professionals",
  description:
    "Browse verified, background-checked home service professionals near you — ratings, reviews, and instant booking on HOMEEIGO.",
  alternates: { canonical: "/providers" },
};

export default function ProvidersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
