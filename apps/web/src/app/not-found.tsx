import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Compass, Home, LayoutGrid, LifeBuoy, Search } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";

export const metadata: Metadata = {
  title: "Page Not Found — HOMEEIGO",
  description: "The page you're looking for doesn't exist. Browse HOMEEIGO home services instead.",
  robots: { index: false, follow: false },
};

const QUICK_LINKS = [
  { href: "/", label: "Home", description: "Back to the homepage", icon: Home },
  { href: "/services", label: "Browse Services", description: "Cleaning, repairs & more", icon: LayoutGrid },
  { href: "/bookings", label: "My Bookings", description: "Track active services", icon: CalendarDays },
  { href: "/support", label: "Get Support", description: "We're here 24/7", icon: LifeBuoy },
];

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-16">
      <AuroraBackground />
      <main className="relative z-10 w-full max-w-2xl text-center">
        <p className="font-display text-lg font-bold text-aurora">HOMEEIGO</p>

        <h1 className="mt-6 font-display text-7xl font-extrabold tracking-tight text-content sm:text-8xl">
          4<span className="text-primary">0</span>4
        </h1>
        <h2 className="mt-4 font-display text-xl font-bold text-content sm:text-2xl">
          This page took the day off
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted sm:text-base">
          The page you&apos;re looking for doesn&apos;t exist, was moved, or the link is broken.
          Let&apos;s get you back on track.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-e3 transition hover:opacity-90"
          >
            <Home size={16} />
            Back to Home
          </Link>
          <Link
            href="/services"
            className="inline-flex items-center gap-2 rounded-2xl border border-line bg-surface/70 px-6 py-3 text-sm font-semibold text-content backdrop-blur transition hover:border-primary hover:text-primary"
          >
            <Search size={16} />
            Explore Services
          </Link>
        </div>

        <div className="mt-12">
          <p className="mb-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
            <Compass size={14} />
            Popular destinations
          </p>
          <ul className="grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
            {QUICK_LINKS.map(({ href, label, description, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-2xl glass-card px-4 py-3.5 transition hover:bg-primary/5"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-content">{label}</span>
                    <span className="block truncate text-xs text-muted">{description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
