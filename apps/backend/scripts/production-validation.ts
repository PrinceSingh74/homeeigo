import { productionValidationService } from "../src/services/production-validation.service";

const report = await productionValidationService.runFullValidation();

console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "PASS" ? 0 : 1);
