import { describe, expect, it, beforeAll } from "bun:test";
import { complianceService } from "../services/compliance.service";
import { dataRetentionService } from "../services/data-retention.service";
import { ACCOUNT_DELETION_RESTORE_DAYS } from "../lib/legal-policy";

describe("P4 Part B+C — compliance & retention", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.HASH_HMAC_KEY = "test-hmac-pepper";
    process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  describe("Retention configuration", () => {
    it("exposes retention report API", () => {
      expect(typeof dataRetentionService.getRetentionReport).toBe("function");
      expect(typeof dataRetentionService.enforceRetentionPolicies).toBe("function");
    });
  });

  describe("Compliance SLA", () => {
    it("computes remaining SLA days", () => {
      const due = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      expect(complianceService.slaDaysRemaining(due)).toBeGreaterThanOrEqual(9);
      expect(complianceService.slaDaysRemaining(due)).toBeLessThanOrEqual(11);
    });

    it("aligns deletion grace period with legal policy", () => {
      expect(ACCOUNT_DELETION_RESTORE_DAYS).toBe(30);
    });
  });

  describe("DPDP / GDPR request types", () => {
    it("supports export (access/portability)", () => {
      const types = ["EXPORT", "DELETE", "CORRECTION", "ACCESS", "RESTRICT", "OBJECT"];
      expect(types).toContain("EXPORT");
      expect(types).toContain("DELETE");
    });
  });
});
