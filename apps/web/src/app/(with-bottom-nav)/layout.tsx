import { ProtectedAppShell } from "@/components/layout/ProtectedAppShell";
import { WithBottomNavLayout } from "@/components/layout/WithBottomNavLayout";

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedAppShell>
      <WithBottomNavLayout>{children}</WithBottomNavLayout>
    </ProtectedAppShell>
  );
}
