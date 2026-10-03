/**
 * Whether payment-signature mocking is permitted in this process.
 *
 * Two controls used to key on `NODE_ENV !== "production"`: the `/api/payments/e2e/mock-signature`
 * route (mints a valid Razorpay HMAC for any order) and `verifyPaymentSignature` auto-passing when
 * no `RAZORPAY_KEY_SECRET` is configured. `.env.staging` runs NODE_ENV=development, so on a staging
 * host any customer could mark their own booking / top-up / gift card / subscription as paid with
 * ₹0 moved. Mocks are now an explicit opt-in that production and staging can never enable.
 */
import { isDeployedEnvironment } from "./deployed-environment";

export function paymentMocksAllowed(): boolean {
  // The deployment test is shared; see lib/deployed-environment for why NODE_ENV alone is wrong.
  if (isDeployedEnvironment()) return false;
  if (process.env.NODE_ENV === "test") return true;
  return process.env.HOMIGO_ALLOW_PAYMENT_MOCKS === "1";
}
