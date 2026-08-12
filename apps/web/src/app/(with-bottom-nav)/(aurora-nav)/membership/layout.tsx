import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HOMEEIGO Premium Membership",
  robots: { index: false, follow: false },
};

export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  return children;
}
