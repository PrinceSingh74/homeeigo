import { redisClient } from "../src/lib/redis";
import { productionValidationService } from "../src/services/production-validation.service";

if (redisClient.isEnabled) {
  await redisClient.connect();
}

const report = await productionValidationService.runFullValidation();

console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "PASS" ? 0 : 1);
