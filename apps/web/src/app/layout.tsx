import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { AppProviders } from "@/components/providers/AppProviders";
import { ChunkLoadRecovery } from "@/components/ChunkLoadRecovery";
import { LazyRoutePrefetch } from "@/components/navigation/LazyRoutePrefetch";
import { WebVitalsReporter } from "@/components/WebVitalsReporter";
import { NavigationTracker } from "@/components/NavigationTracker";
import { ExperienceSignals } from "@/components/ExperienceSignals";
import { RouteProgress } from "@/components/navigation/RouteProgress";
import { PredictivePrefetch } from "@/components/navigation/PredictivePrefetch";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "HOMEEIGO — The Future of Home Services",
    template: "%s | HOMEEIGO",
  },
  description:
    "AI-powered luxury home services marketplace. Smart matching, real-time tracking, instant booking for cleaning, AC repair, plumbing, electrical work and more across India.",
  keywords: [
    "home services",
    "cleaning",
    "AC repair",
    "plumbing",
    "electrician",
    "India",
    "luxury",
    "AI-powered",
    "book home services online",
  ],
  authors: [{ name: "HOMEEIGO Team" }],
  applicationName: "HOMEEIGO",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "HOMEEIGO — The Future of Home Services",
    description:
      "AI-powered home services marketplace. Smart matching, real-time tracking, instant booking.",
    type: "website",
    url: SITE_URL,
    siteName: "HOMEEIGO",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "HOMEEIGO — The Future of Home Services",
    description:
      "AI-powered home services marketplace. Smart matching, real-time tracking, instant booking.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
  width: "device-width",
  initialScale: 1,
};

/** Set theme class before paint to avoid flash of wrong theme. */
const noFlashScript = `(function(){try{var t=localStorage.getItem('homigo-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${sora.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="bg-canvas text-content font-sans antialiased">
        <AppProviders>
          <RouteProgress />
          <PredictivePrefetch />
          <ChunkLoadRecovery />
          <LazyRoutePrefetch />
          <WebVitalsReporter />
          <NavigationTracker />
          <ExperienceSignals />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
