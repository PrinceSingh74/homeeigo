"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ProfileTopBar } from "@/components/profile/ProfileTopBar";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { MembershipCard } from "@/components/profile/MembershipCard";
import { EmailVerificationCard } from "@/components/profile/EmailVerificationCard";
import { StatsCards } from "@/components/profile/StatsCards";
import {
  profileContainer,
  profileContent,
  profileMain,
  profilePageHeader,
  profilePageRoot,
  profilePageTitle,
  profileQuadGrid,
  profileShell,
  profileTwoColGrid,
} from "@/components/profile/profile-page-layout";

function PanelFallback() {
  return <div className="h-40 animate-pulse rounded-2xl bg-surface/50" aria-hidden />;
}

const MembershipInsightsPanel = dynamic(
  () => import("@/components/membership/MembershipInsightsPanel").then((m) => m.MembershipInsightsPanel),
  { loading: () => <PanelFallback /> },
);

const ProfileBookings = dynamic(
  () => import("@/components/profile/ProfileBookings").then((m) => m.ProfileBookings),
  { loading: () => <PanelFallback /> },
);

const AIInsights = dynamic(
  () => import("@/components/profile/AIInsights").then((m) => m.AIInsights),
  { loading: () => <PanelFallback /> },
);

const SavedAddresses = dynamic(
  () => import("@/components/profile/SavedAddresses").then((m) => m.SavedAddresses),
  { loading: () => <PanelFallback /> },
);

const PaymentSecurity = dynamic(
  () => import("@/components/profile/PaymentSecurity").then((m) => m.PaymentSecurity),
  { loading: () => <PanelFallback /> },
);

const RewardsReferrals = dynamic(
  () => import("@/components/profile/RewardsReferrals").then((m) => m.RewardsReferrals),
  { loading: () => <PanelFallback /> },
);

const ProfileSettings = dynamic(
  () => import("@/components/profile/ProfileSettings").then((m) => m.ProfileSettings),
  { loading: () => <PanelFallback /> },
);

const DevicesSessions = dynamic(
  () => import("@/components/profile/DevicesSessions").then((m) => m.DevicesSessions),
  { loading: () => <PanelFallback /> },
);

const InfoCards = dynamic(
  () => import("@/components/profile/InfoCards").then((m) => m.InfoCards),
  { loading: () => <PanelFallback /> },
);

export function ProfileDashboard() {
  return (
    <div className={profilePageRoot}>
      <div className={profileShell}>
        <ProfileTopBar />

        <div className={profileMain}>
          <div className={profileContainer}>
            <header className={profilePageHeader}>
              <h1 className={profilePageTitle}>Profile</h1>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted sm:mt-2 sm:text-base">
                Your account, bookings, rewards and settings
              </p>
            </header>

            <main className={profileContent}>
              <ProfileHeader />
              <MembershipCard />
              <Suspense fallback={<PanelFallback />}>
                <MembershipInsightsPanel />
              </Suspense>
              <StatsCards />
              <EmailVerificationCard />

              <div className={profileTwoColGrid}>
                <ProfileBookings />
                <AIInsights />
              </div>

              <div className={profileQuadGrid}>
                <SavedAddresses />
                <PaymentSecurity />
                <RewardsReferrals />
                <ProfileSettings />
              </div>

              <DevicesSessions />
              <InfoCards />

              <footer className="border-t border-line/80 pt-6 text-center text-[11px] text-muted sm:pt-8 sm:text-xs">
                <p>© {new Date().getFullYear()} HOMEEIGO · Premium home services</p>
                <p className="mt-1">Your personal hub for bookings, wallet & AI insights</p>
              </footer>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
