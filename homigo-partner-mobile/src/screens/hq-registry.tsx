import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { findNavItem } from "@/lib/partner-navigation";
import {
  AcademyCertificationsScreen,
  AcademyTrainingScreen,
  AccountAvailabilityScreen,
  AccountInvoicesScreen,
  AccountMapScreen,
  AccountMembershipScreen,
  AccountNotificationsScreen,
  AccountProfileScreen,
  AccountSettingsScreen,
  AccountSupportScreen,
  RewardsBadgesScreen,
  RewardsHubScreen,
  RewardsReferralsScreen,
  TrustComplianceScreen,
  TrustDocumentsScreen,
  TrustVerificationScreen,
  WellbeingCommunityScreen,
  WellbeingInsuranceScreen,
  WellbeingSosScreen,
} from "@/screens/hq-academy-account";
import {
  AiAssistantScreen,
  AiDemandForecastScreen,
  AiIntelligenceScreen,
  AiRouteScreen,
  PerformanceAnalyticsScreen,
  PerformanceQualityScreen,
  PerformanceRankingsScreen,
  PerformanceReviewsScreen,
  PerformanceScorecardScreen,
  TerritoryAnalyticsScreen,
  TerritoryCoverageScreen,
  TerritoryHeatmapScreen,
  TerritoryNavigationScreen,
} from "@/screens/hq-performance-ai-territory";
import {
  EarningsDetailScreen,
  EarningsForecastScreen,
  EarningsHqScreen,
  EarningsIncentivesScreen,
  EarningsPayoutsScreen,
  EarningsTaxScreen,
  RouteCenterScreen,
  WalletLedgerScreen,
  WalletScreen,
  WorkAttendanceScreen,
  WorkHqScreen,
  WorkScheduleScreen,
  WorkServiceHistoryScreen,
} from "@/screens/hq-work-earnings";
import { RequestsScreen } from "@/screens/RequestsScreen";

type ScreenComponent = ComponentType;

export const HQ_SCREEN_REGISTRY: Record<string, ScreenComponent> = {
  dashboard: DashboardRedirectScreen,
  "work-hq": WorkHqScreen,
  requests: () => <RequestsScreen embedded />,
  "route-center": RouteCenterScreen,
  "work-attendance": WorkAttendanceScreen,
  "work-schedule": WorkScheduleScreen,
  "work-service-history": WorkServiceHistoryScreen,
  "earnings-hq": EarningsHqScreen,
  "earnings-detail": EarningsDetailScreen,
  wallet: () => <WalletScreen />,
  "wallet-ledger": WalletLedgerScreen,
  "earnings-payouts": EarningsPayoutsScreen,
  "earnings-incentives": EarningsIncentivesScreen,
  "earnings-tax": EarningsTaxScreen,
  "earnings-forecast": EarningsForecastScreen,
  "performance-reviews": PerformanceReviewsScreen,
  "performance-scorecard": PerformanceScorecardScreen,
  "performance-rankings": PerformanceRankingsScreen,
  "performance-quality": PerformanceQualityScreen,
  "performance-analytics": PerformanceAnalyticsScreen,
  "ai-assistant": AiAssistantScreen,
  "ai-demand-forecast": AiDemandForecastScreen,
  "ai-route": AiRouteScreen,
  "ai-intelligence": AiIntelligenceScreen,
  "territory-navigation": TerritoryNavigationScreen,
  "territory-heatmap": TerritoryHeatmapScreen,
  "territory-coverage": TerritoryCoverageScreen,
  "territory-analytics": TerritoryAnalyticsScreen,
  "academy-training": AcademyTrainingScreen,
  "academy-certifications": AcademyCertificationsScreen,
  "trust-documents": TrustDocumentsScreen,
  "trust-verification": TrustVerificationScreen,
  "trust-compliance": TrustComplianceScreen,
  "rewards-hub": RewardsHubScreen,
  "rewards-badges": RewardsBadgesScreen,
  "rewards-referrals": RewardsReferralsScreen,
  "wellbeing-insurance": WellbeingInsuranceScreen,
  "wellbeing-sos": WellbeingSosScreen,
  "wellbeing-community": WellbeingCommunityScreen,
  "account-profile": AccountProfileScreen,
  "account-notifications": AccountNotificationsScreen,
  "account-settings": AccountSettingsScreen,
  "account-support": AccountSupportScreen,
  "account-membership": AccountMembershipScreen,
  "account-invoices": AccountInvoicesScreen,
  "account-availability": AccountAvailabilityScreen,
  "account-map": AccountMapScreen,
};

function DashboardRedirectScreen() {
  const meta = findNavItem("dashboard");
  return (
    <PartnerScreen title={meta?.item.label ?? "Dashboard"} subtitle={meta?.item.subtitle} showBack>
      <View>
        <Text>Use the Home tab for your live dashboard.</Text>
      </View>
    </PartnerScreen>
  );
}

export function HqScreenById({ id }: { id: string }) {
  const Screen = HQ_SCREEN_REGISTRY[id];
  if (!Screen) {
    return (
      <PartnerScreen title="Not found" subtitle="This HQ screen is not available." showBack>
        <View />
      </PartnerScreen>
    );
  }
  return <Screen />;
}
