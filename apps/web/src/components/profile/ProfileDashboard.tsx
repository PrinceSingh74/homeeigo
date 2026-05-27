"use client";

import { ProfileTopBar } from "@/components/profile/ProfileTopBar";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { MembershipCard } from "@/components/profile/MembershipCard";
import { StatsCards } from "@/components/profile/StatsCards";
import { ProfileBookings } from "@/components/profile/ProfileBookings";
import { AIInsights } from "@/components/profile/AIInsights";
import { SavedAddresses } from "@/components/profile/SavedAddresses";
import { PaymentSecurity } from "@/components/profile/PaymentSecurity";
import { RewardsReferrals } from "@/components/profile/RewardsReferrals";
import { ProfileSettings } from "@/components/profile/ProfileSettings";
import { InfoCards } from "@/components/profile/InfoCards";
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
              <StatsCards />

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

              <InfoCards />

              <footer className="border-t border-line/80 pt-6 text-center text-[11px] text-muted sm:pt-8 sm:text-xs">
                <p>© {new Date().getFullYear()} HOMIGO · Premium home services</p>
                <p className="mt-1">Your personal hub for bookings, wallet & AI insights</p>
              </footer>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
