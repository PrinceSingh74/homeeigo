import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { PartnerProviders } from "@/components/providers/PartnerProviders";
import { PartnerAuthGuard } from "@/components/auth/PartnerAuthGuard";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HOMIGO Partner — Vendor Dashboard",
  description:
    "Professional operating system for HOMIGO service partners. Jobs, earnings, live tracking, AI.",
  applicationName: "HOMIGO Pro",
};

export const viewport: Viewport = {
  themeColor: "#071028",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${space.variable} ${jetbrains.variable}`}
    >
      <body className="font-sans antialiased">
        <PartnerProviders>
          <PartnerAuthGuard>{children}</PartnerAuthGuard>
        </PartnerProviders>
      </body>
    </html>
  );
}
