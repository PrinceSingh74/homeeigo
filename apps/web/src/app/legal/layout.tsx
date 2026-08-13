import { LegalShell } from "@/components/legal/LegalShell";

/**
 * Shared chrome for every legal route. Deliberately no metadata title/template
 * here — each document keeps the exact title and canonical it already had.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
