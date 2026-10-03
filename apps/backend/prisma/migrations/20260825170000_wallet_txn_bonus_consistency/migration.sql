-- BONUS (incentives, cashback) and WITHDRAWAL are valid completed wallet effects.
-- Original check only allowed CREDIT/REFUND/DEBIT, which blocked PartnerIncentivePayout credits.
ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_balance_consistency";
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_balance_consistency" CHECK (
  (status)::text <> 'COMPLETED'
  OR wallet_balance_after IS NULL
  OR wallet_balance_before IS NULL
  OR (
    (type)::text = ANY (ARRAY['CREDIT'::text, 'REFUND'::text, 'BONUS'::text])
    AND abs(wallet_balance_after - (wallet_balance_before + amount)) < 0.005
  )
  OR (
    (type)::text = ANY (ARRAY['DEBIT'::text, 'WITHDRAWAL'::text])
    AND abs(wallet_balance_after - (wallet_balance_before - amount)) < 0.005
  )
  OR (type)::text = 'REVERSAL'
);
