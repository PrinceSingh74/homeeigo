/**
 * Enterprise OS V6 intelligence Prometheus gauges — sampled from live services.
 */
import { setGauge, registerScrapeSampler } from "./metrics";
import { customerIntelligenceService } from "../services/customer-intelligence.service";
import { growthIntelligenceService } from "../services/growth-intelligence.service";
import { riskIntelligenceService } from "../services/risk-intelligence.service";
import { platformIntelligenceService } from "../services/platform-intelligence.service";
import { recoveryIntelligenceService } from "../services/recovery-intelligence.service";

const TTL_MS = 60_000;
let last = 0;

export function registerEnterpriseIntelligenceSamplers(): void {
  registerScrapeSampler(async () => {
    const now = Date.now();
    if (now - last < TTL_MS) return;
    last = now;

    const [cx, growth, risk, platform, recovery] = await Promise.all([
      customerIntelligenceService.getIntelligence(30).catch(() => null),
      growthIntelligenceService.getIntelligence(30).catch(() => null),
      riskIntelligenceService.getIntelligence(30).catch(() => null),
      platformIntelligenceService.getIntelligence().catch(() => null),
      recoveryIntelligenceService.getStatus().catch(() => null),
    ]);

    if (cx) {
      if (cx.nps.score != null) setGauge("cx_nps_score", cx.nps.score);
      if (cx.csat.scorePct != null) setGauge("cx_csat_pct", cx.csat.scorePct);
      if (cx.customerHappinessScore != null) setGauge("cx_happiness_score", cx.customerHappinessScore);
      if (cx.serviceSatisfactionIndex != null) setGauge("cx_service_satisfaction_index", cx.serviceSatisfactionIndex);
    }

    if (growth) {
      if (growth.cac > 0) setGauge("growth_cac_inr", Math.round(growth.cac));
      if (growth.ltv > 0) setGauge("growth_ltv_inr", Math.round(growth.ltv));
      if (growth.ltvCacRatio != null) setGauge("growth_ltv_cac_ratio", growth.ltvCacRatio);
      if (growth.roas.value != null) setGauge("growth_roas", growth.roas.value);
      if (growth.paybackMonths.value != null) setGauge("growth_payback_months", growth.paybackMonths.value);
    }

    if (risk) {
      setGauge("risk_unified_trust_score", risk.unifiedTrustScore.score);
      setGauge("risk_fraud_confidence", risk.fraudConfidence.score);
      setGauge("risk_payment_risk_score", risk.paymentRisk.score);
      setGauge("risk_compliance_risk_score", risk.complianceRisk.score);
    }

    if (platform) {
      setGauge("platform_flags_total", platform.flagCount);
      setGauge("platform_flags_enabled", platform.enabledFlags);
      const running = platform.experiments.filter((e) => e.status === "running").length;
      setGauge("platform_experiments_running", running);
    }

    if (recovery) {
      setGauge("recovery_dr_readiness_score", recovery.disasterRecovery.readinessScore);
      setGauge("recovery_backup_count", recovery.backup.totalBackups);
    }
  });
}
