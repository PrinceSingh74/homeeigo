import { AdminShell } from "@/components/layout/AdminShell";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
