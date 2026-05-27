import { WithBottomNavLayout } from "@/components/layout/WithBottomNavLayout";

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WithBottomNavLayout>{children}</WithBottomNavLayout>;
}
