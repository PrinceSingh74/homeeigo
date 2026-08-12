// HOMIGO Wallet Load Test (k6).
//
//   k6 run -e STAGE=100 -e LOGIN_EMAIL=u@x -e LOGIN_PASSWORD=… scripts/load-test/k6/wallet.js
//
// Validates: balance/transactions/transfers reads; concurrent balance operations.
// Mutating ops (top-up, transfer, withdrawal, gift-card redeem, hcoin redeem)
// require ALLOW_WRITES=1 against STAGING. Ledger-drift / double-spend / negative
// balance are asserted by the separate wallet-integrity-check.ts after the run.
import { sleep, group } from "k6";
import { ALLOW_WRITES, baseOptions, login, authHeaders, get, post, writeSummary } from "./lib.js";

export const options = baseOptions();

export function setup() {
  return { token: login() };
}

export default function (data) {
  const h = authHeaders(data.token);

  group("wallet reads (concurrent balance)", () => {
    if (data.token) {
      get("/api/wallet/balance", { headers: h, tags: { name: "balance" } });
      get("/api/wallet/transactions?limit=10", { headers: h, tags: { name: "transactions" } });
      get("/api/wallet/transfers", { headers: h, tags: { name: "transfers" } });
    }
    get("/api/wallet/offers", { tags: { name: "offers" } });
  });

  if (ALLOW_WRITES && data.token) {
    group("wallet mutations (staging)", () => {
      // Small concurrent transfers stress the balance lock without draining funds.
      if (__ENV.TRANSFER_TO) post("/api/wallet/transfer", { toUserId: __ENV.TRANSFER_TO, amount: 1 }, { headers: h, tags: { name: "transfer" } });
      if (__ENV.GIFT_CARD_CODE) post("/api/wallet/gift-cards/redeem", { code: __ENV.GIFT_CARD_CODE }, { headers: h, tags: { name: "giftcard_redeem" } });
    });
  }

  sleep(1);
}

export function handleSummary(data) {
  return writeSummary("wallet", data);
}
