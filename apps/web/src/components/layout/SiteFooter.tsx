import Image from "next/image";
import Link from "next/link";
import { pageSection } from "@/lib/page-layout";

const FOOTER_COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Explore",
    links: [
      { href: "/", label: "Home" },
      { href: "/services", label: "Services" },
      { href: "/providers", label: "Professionals" },
      { href: "/ai", label: "AI Assistant" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/bookings", label: "My Bookings" },
      { href: "/wallet", label: "Wallet" },
      { href: "/membership", label: "Premium Membership" },
      { href: "/referrals", label: "Refer & Earn" },
    ],
  },
  {
    heading: "Support",
    links: [
      { href: "/support", label: "Help & Support" },
      { href: "/notifications", label: "Notifications" },
      { href: "/settings", label: "Settings" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/cookies", label: "Cookie Policy" },
      { href: "/legal/refund", label: "Refund Policy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className={`${pageSection} mt-16 pb-12 sm:mt-20`}>
      <div className="relative overflow-hidden rounded-[28px] glass-card p-6 sm:p-10">
        {/* Brand hairline across the top edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-500 to-teal-500 opacity-80"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-emerald-400 opacity-[0.08] blur-3xl"
        />

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-4 lg:col-span-1">
            {/* Light artwork on light UI; light-wordmark variant in night mode. */}
            <Image
              src="/brand/logo-full.png"
              alt="Homeeigo"
              width={560}
              height={386}
              className="h-[104px] w-[151px] object-contain dark:hidden"
            />
            <Image
              src="/brand/logo-full-dark.png"
              alt="Homeeigo"
              width={560}
              height={386}
              className="hidden h-[104px] w-[151px] object-contain dark:block"
            />
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
              The Future of Home Services · Made with 💚 in India
            </p>
          </div>
          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <nav key={heading} aria-label={heading}>
              <p className="text-xs font-bold uppercase tracking-widest text-muted">{heading}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {links.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group inline-flex items-center gap-1 text-sm text-content transition hover:text-emerald-600"
                    >
                      <span className="h-px w-0 bg-emerald-500 transition-all duration-300 group-hover:w-3" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 border-t border-line/70 pt-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-xs text-muted">
            © {new Date().getFullYear()} HOMEEIGO. All rights reserved.
          </p>
          <p className="text-xs font-medium text-muted">
            Verified pros · Secure payments · AI-powered
          </p>
        </div>
      </div>
    </footer>
  );
}
