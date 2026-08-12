import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, IBM_Plex_Sans } from "next/font/google";
import { AdminAuthGuard } from "@/components/auth/AdminAuthGuard";
import { AdminAuthProvider } from "@/providers/AdminAuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import "./globals.css";

/* Enterprise typography — Inter (primary) · Inter Tight (display) · IBM Plex Sans (numerals) */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HOMEEIGO Business HQ — Admin",
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
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${plexSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply saved theme before paint (no FOUC). Default = dark Graphite. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('homigo-admin-theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}",
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <QueryProvider>
          <AdminAuthProvider>
            <AdminAuthGuard>{children}</AdminAuthGuard>
          </AdminAuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
