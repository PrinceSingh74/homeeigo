/**
 * Reconcile gift-card / subscription activations missed by client verify.
 *   bun --env-file=.env run scripts/reconcile-pending-payments.ts
 */
import { paymentService } from "../src/services/payment.service";

const result = await paymentService.reconcilePendingOrders();
console.log(`✅ Reconciled gift cards: ${result.giftCards}, subscriptions: ${result.subscriptions}`);
