import type { Metadata, Viewport } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/AppProviders";
import { ChunkLoadRecovery } from "@/components/ChunkLoadRecovery";
import { RoutePrefetch } from "@/components/navigation/RoutePrefetch";
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
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HOMIGO — The Future of Home Services",
  description:
    "AI-powered luxury home services marketplace. Smart matching, real-time tracking, instant booking.",
  keywords: [
    "home services",
    "cleaning",
    "AC repair",
    "plumbing",
    "electrician",
    "India",
    "luxury",
    "AI-powered",
  ],
  authors: [{ name: "HOMIGO Team" }],
  openGraph: {
    title: "HOMIGO",
    description: "The Future of Home Services",
    type: "website",
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
      className={`${inter.variable} ${sora.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="bg-canvas text-content font-sans antialiased">
        <AppProviders>
          <ChunkLoadRecovery />
          <RoutePrefetch />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
