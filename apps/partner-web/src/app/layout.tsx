import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { PartnerProviders } from "@/components/providers/PartnerProviders";
import { PartnerAuthGuard } from "@/components/auth/PartnerAuthGuard";
import { PartnerRealtimeBridge } from "@/components/realtime/PartnerRealtimeBridge";
import { PartnerRoutePrefetch } from "@/components/navigation/PartnerRoutePrefetch";
import { RouteProgress } from "@/components/navigation/RouteProgress";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
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
  title: "HOMEEIGO Partner — Vendor Dashboard",
  description:
    "Professional operating system for HOMEEIGO service partners. Jobs, earnings, live tracking, AI.",
  applicationName: "HOMEEIGO Pro",
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
      className={`${inter.variable} ${interTight.variable} ${space.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <PartnerProviders>
          <RouteProgress />
          <PartnerRoutePrefetch />
          <PartnerAuthGuard>{children}</PartnerAuthGuard>
          <PartnerRealtimeBridge />
          <Toaster />
        </PartnerProviders>
      </body>
    </html>
  );
}
