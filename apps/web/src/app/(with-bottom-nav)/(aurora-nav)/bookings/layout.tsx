import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Bookings",
  robots: { index: false, follow: false },
};

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
