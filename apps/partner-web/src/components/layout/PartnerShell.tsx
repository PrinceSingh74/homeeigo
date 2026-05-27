"use client";

import { useState } from "react";
import { PartnerBottomNav } from "./PartnerBottomNav";
import { PartnerSidebar } from "./PartnerSidebar";
import { PartnerTopBar } from "./PartnerTopBar";
import { partnerLayout } from "@/lib/partner-layout";

export function PartnerShell({ children }: { children: React.ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <div className="partner-mesh min-h-dvh">
      <PartnerSidebar
        mobileOpen={mobileNav}
        onMobileClose={() => setMobileNav(false)}
      />
      <div className="flex min-h-dvh flex-col lg:pl-[var(--sidebar-width)]">
        <PartnerTopBar onMenuOpen={() => setMobileNav(true)} />
        <main className="partner-scroll partner-main flex-1 overflow-y-auto">
          <div className={partnerLayout.page}>{children}</div>
        </main>
      </div>
      <PartnerBottomNav />
    </div>
  );
}
