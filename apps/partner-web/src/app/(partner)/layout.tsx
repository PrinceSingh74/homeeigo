import { PartnerShell } from "@/components/layout/PartnerShell";

export default function PartnerAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PartnerShell>{children}</PartnerShell>;
}
