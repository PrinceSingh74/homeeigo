import { AuroraNavShell } from "@/components/layout/AuroraNavShell";

export default function AuroraNavLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuroraNavShell>{children}</AuroraNavShell>;
}
