"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { NAVBAR_OFFSET } from "@/components/navbar-constants";
import { cn } from "@/lib/utils";

const Navbar = dynamic(
  () => import("@/components/Navbar").then((m) => ({ default: m.Navbar })),
  {
    ssr: false,
    loading: () => (
      <header
        className="fixed inset-x-0 top-0 z-50 h-14 border-b border-line/40 bg-canvas/80 backdrop-blur-md"
        aria-hidden
      />
    ),
  },
);

const BottomNav = dynamic(
  () => import("@/components/BottomNav").then((m) => ({ default: m.BottomNav })),
  { ssr: false },
);

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
        {children}
        <BottomNav />
      </div>
    </>
  );
}
