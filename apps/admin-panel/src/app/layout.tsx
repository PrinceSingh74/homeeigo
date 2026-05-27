import type { Metadata, Viewport } from "next";
import { AdminAuthGuard } from "@/components/auth/AdminAuthGuard";
import "./globals.css";

export const metadata: Metadata = {
  title: "HOMIGO Business HQ — Admin",
  description:
    "Company operations dashboard. Vendors, bookings, payments, fraud, AI — separate from partner and customer apps.",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AdminAuthGuard>{children}</AdminAuthGuard>
      </body>
    </html>
  );
}
