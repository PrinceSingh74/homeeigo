"use client";

import { usePathname } from "next/navigation";
import { Navbar, NAVBAR_OFFSET } from "@/components/Navbar";
import { BottomNavShell } from "@/components/layout/BottomNavShell";
import { cn } from "@/lib/utils";

function isImmersiveRoute(pathname: string) {
  return (
    pathname === "/wallet" ||
    pathname.startsWith("/wallet/") ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/") ||
    pathname === "/ai" ||
    pathname.startsWith("/ai/")
  );
}

/** Site header hidden on immersive app shells — mobile only. */
export function WithBottomNavLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const hideSiteNavOnMobile = isImmersiveRoute(pathname);

  return (
    <>
      <div className={cn(hideSiteNavOnMobile && "max-lg:hidden")}>
        <Navbar />
      </div>
      <div
        className={cn(
          "min-w-0",
          hideSiteNavOnMobile
            ? "max-lg:pt-0 lg:pt-[calc(3.5rem+env(safe-area-inset-top,0px))]"
            : "pt-[calc(3.5rem+env(safe-area-inset-top,0px))]",
        )}
        style={{ ["--navbar-offset" as string]: NAVBAR_OFFSET }}
      >
        <BottomNavShell>{children}</BottomNavShell>
      </div>
    </>
  );
}
