import Link from "next/link";
import { LEGAL_VERSION } from "@/lib/legal/content";

type Section = { heading: string; body: string };

export function LegalPageLayout({
  title,
  sections,
}: {
  title: string;
  sections: readonly Section[];
}) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Legal</p>
      <h1 className="font-display text-3xl font-bold text-content">{title}</h1>
      <p className="mt-2 text-sm text-muted">Effective {LEGAL_VERSION}</p>

      <div className="mt-8 space-y-8">
        {sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-display text-lg font-bold text-content">{s.heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </section>
        ))}
      </div>

      <nav className="mt-12 flex flex-wrap gap-4 border-t border-line pt-6 text-sm">
        <Link href="/legal/privacy" className="text-primary hover:underline">
          Privacy
        </Link>
        <Link href="/legal/terms" className="text-primary hover:underline">
          Terms
        </Link>
        <Link href="/legal/refund" className="text-primary hover:underline">
          Refunds
        </Link>
        <Link href="/legal/cookies" className="text-primary hover:underline">
          Cookies
        </Link>
        <Link href="/" className="text-muted hover:text-content">
          Home
        </Link>
      </nav>
    </main>
  );
}
