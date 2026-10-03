import { providerService } from "./provider.service";
import { partnerOsService } from "./partner-os.service";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { classifyPartnerIntent, type PartnerAiIntent } from "../ai/intent/partner-intent";

export type CopilotBasis = string[];

export type CopilotFallback = {
  content: string;
  basis: CopilotBasis;
  recommendation: string | null;
  intent: PartnerAiIntent;
};

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function insufficient(topic: string, intent: PartnerAiIntent): CopilotFallback {
  return {
    intent,
    basis: [],
    recommendation: null,
    content: `I don't have enough verified data to answer that reliably (${topic}).`,
  };
}

function format(answer: string, basis: CopilotBasis, recommendation: string | null): string {
  const parts = [answer];
  if (basis.length > 0) parts.push(`Based on: ${basis.join("; ")}.`);
  if (recommendation) parts.push(recommendation);
  return parts.join(" ");
}

/**
 * Deterministic partner copilot. Runs only when the LLM path is unavailable.
 *
 * Every number comes from an existing service. No Prisma. No mutations.
 */
export class PartnerCopilotService {
  async answer(providerId: string, message: string): Promise<CopilotFallback> {
    const { intent } = classifyPartnerIntent(message);
    try {
      switch (intent) {
        case "MUTATION_REQUEST":
          return {
            intent,
            basis: ["Policy: AI cannot execute high-risk financial or account actions"],
            recommendation: "Use the existing payout or incentive workflow if you need a payment.",
            content: format(
              "I cannot pay incentives, move money, change availability, alter job state, or grant database access.",
              ["AI is read-and-recommend only"],
              "High-risk actions require human approval through the existing business service.",
            ),
          };
        case "EARNINGS":
          return this.earnings(providerId, intent);
        case "PAYOUT":
          return this.payout(providerId, intent);
        case "JOBS":
          return this.jobs(providerId, intent);
        case "SCHEDULE":
          return this.schedule(providerId, intent);
        case "DEMAND":
          return this.demand(providerId, intent);
        case "PERFORMANCE":
          return this.performance(providerId, intent);
        case "TRAINING":
          return this.training(providerId, intent);
        case "CAREER":
          return this.career(providerId, intent);
        case "ROUTE":
          return this.jobs(providerId, intent);
        default:
          return {
            intent,
            basis: [],
            recommendation: "Ask about earnings, next jobs, demand, performance, or training.",
            content:
              "I can explain your earnings, schedule, demand, performance and training from verified tools. Live AI is temporarily using this verified summary path.",
          };
      }
    } catch {
      return insufficient("service error", intent);
    }
  }

  private async earnings(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const summary = await providerService.myEarningsSummary(providerId, 7);
    if (!summary.totalJobs) return insufficient("earnings this week", intent);
    const basis = [`${summary.totalJobs} completed jobs`, "last 7 days net earnings"];
    return {
      intent,
      basis,
      recommendation: null,
      content: format(`You earned ${inr(summary.totalNet)} this week.`, basis, null),
    };
  }

  private async payout(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const { earningsService } = await import("./earnings.service");
    const finance = await earningsService.getPartnerFinanceCenter(providerId);
    const basis = ["wallet available balance", "pending withdrawals"];
    const next = finance.nextPayoutDate
      ? `Next payout date on file: ${new Date(finance.nextPayoutDate).toLocaleDateString("en-IN")}.`
      : "No pending payout date on file.";
    return {
      intent,
      basis,
      recommendation: "I cannot trigger a payout. Request one from Finance HQ if eligible.",
      content: format(
        `Available balance ${inr(finance.availableBalance)}. Pending ${inr(finance.pendingBalance)}. ${next}`,
        basis,
        null,
      ),
    };
  }

  private async jobs(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const bookings = await providerService.myBookings(providerId, { page: "1", sortBy: "upcoming" });
    const items = (bookings as { bookings?: Array<{ status: string; service?: { name?: string } }> }).bookings ?? [];
    const active = items.filter((b) =>
      ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PENDING"].includes(b.status),
    );
    if (active.length === 0) return insufficient("upcoming jobs", intent);
    const basis = [`${active.length} active/pending jobs on your roster`];
    const labels = active.slice(0, 5).map((b) => `${b.service?.name ?? "Job"} (${b.status})`);
    return {
      intent,
      basis,
      recommendation: "Open Route Center to sequence travel. I will not change job state.",
      content: format(`Your next jobs: ${labels.join(", ")}.`, basis, null),
    };
  }

  private async schedule(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const attendance = await partnerOsService.getAttendance(providerId);
    const basis = ["attendance record"];
    const hours =
      attendance.workingHoursStart && attendance.workingHoursEnd
        ? `${attendance.workingHoursStart}–${attendance.workingHoursEnd}`
        : "not set";
    return {
      intent,
      basis,
      recommendation: "Demand windows are on Smart Zones. Going online is still your decision.",
      content: format(
        `You are ${attendance.isCheckedIn ? "checked in" : "checked out"}. Working hours ${hours}. Weekly attendance sessions: ${attendance.weeklyAttendance}.`,
        basis,
        null,
      ),
    };
  }

  private async demand(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const [forecast, scoring] = await Promise.all([
      partnerOsService.getForecast(providerId),
      geoIntelligenceService.zoneScoring(),
    ]);
    const ranked = ((scoring.data as { ranked?: Array<{
      name: string; demand24h: number; supply: number; gap: number; interpretation: string; recommendation: string | null;
    }> } | null)?.ranked) ?? [];
    const top = ranked[0];
    if (!top) return insufficient("zone demand", intent);
    const basis = [
      `${top.name}: demand ${top.demand24h}, supply ${top.supply}, gap ${top.gap}`,
      "heuristic opportunity score (not a guaranteed forecast)",
    ];
    const rec = top.recommendation;
    const today = forecast.todayProjection;
    return {
      intent,
      basis,
      recommendation: rec,
      content: format(
        `Strongest opportunity is ${top.name} (${top.interpretation.replaceAll("_", " ").toLowerCase()}). Today's earnings projection is ${inr(today)} — heuristic, not a promise.`,
        basis,
        rec,
      ),
    };
  }

  private async performance(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const summary = await partnerOsService.getPerformanceSummary(providerId, 90);
    if (!summary) return insufficient("performance", intent);
    const p = summary.performance;
    const basis = [
      `${summary.volume.completedInWindow} completed jobs in ${summary.periodDays} days`,
      "canonical counters — score is not regenerated by AI",
    ];
    return {
      intent,
      basis,
      recommendation: p.acceptanceRate < 90 ? "Lift acceptance toward 90% to improve matching priority." : null,
      content: format(
        `Rating ${p.rating.toFixed(2)}, acceptance ${Math.round(p.acceptanceRate)}%, completion ${Math.round(p.completionRate)}%.`,
        basis,
        null,
      ),
    };
  }

  private async training(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const { partnerOnboardingService } = await import("./partner-onboarding.service");
    const training = await partnerOnboardingService.getTraining(providerId);
    const remaining = training.modules.filter((m) => m.status !== "COMPLETED").slice(0, 3);
    if (training.modules.length === 0) return insufficient("Academy modules", intent);
    const basis = [`${training.completedCount} of ${training.requiredModules} modules complete`];
    const rec =
      remaining.length > 0
        ? `Complete: ${remaining.map((m) => m.title ?? m.id).join(", ")}.`
        : "Required Academy training is complete.";
    return {
      intent,
      basis,
      recommendation: rec,
      content: format(
        training.trainingComplete
          ? "Your required Academy training is complete."
          : `You have ${training.remaining} Academy module(s) remaining.`,
        basis,
        rec,
      ),
    };
  }

  private async career(providerId: string, intent: PartnerAiIntent): Promise<CopilotFallback> {
    const { partnerCareerService } = await import("./partner-career.service");
    const career = await partnerCareerService.getCurrent(providerId);
    if (!career) return insufficient("career progress", intent);
    const basis = ["canonical career record — AI cannot change career status"];
    const level = (career as { currentLevel?: string }).currentLevel ?? "current level";
    return {
      intent,
      basis,
      recommendation: "Complete the listed requirements. I cannot promote your tier.",
      content: format(`Your career level is ${level}.`, basis, null),
    };
  }
}

export const partnerCopilotService = new PartnerCopilotService();
