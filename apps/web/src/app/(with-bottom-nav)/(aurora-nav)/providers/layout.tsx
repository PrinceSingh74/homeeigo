import type { Metadata } from "next";

export const metadata: Metadata = {
  // "Approved": every listed professional is admin-approved. Identity and background checks are
  // required only where a service asks for them, so they are not claimed for all.
  title: "Home Service Professionals",
  description:
    "Browse approved home service professionals near you — ratings, reviews and booking on HOMEEIGO.",
  alternates: { canonical: "/providers" },
};

export default function ProvidersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
