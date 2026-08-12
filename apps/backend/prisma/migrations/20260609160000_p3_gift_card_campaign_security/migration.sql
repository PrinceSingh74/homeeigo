-- P3 Part C: Gift card brute-force protection + campaign per-user limits

ALTER TABLE "gift_cards" ADD COLUMN "last_attempt_at" TIMESTAMP(3);
ALTER TABLE "gift_cards" ADD COLUMN "failed_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "gift_card_redemption_attempts" (
  "id" TEXT NOT NULL,
  "gift_card_code" TEXT NOT NULL,
  "gift_card_id" TEXT,
  "user_id" TEXT,
  "ip_address" TEXT NOT NULL,
  "user_agent" TEXT NOT NULL,
  "device_id" TEXT,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "attempt_number" INTEGER NOT NULL,
  "blocked_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gift_card_redemption_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gift_card_redemption_attempts_ip_address_created_at_idx"
  ON "gift_card_redemption_attempts"("ip_address", "created_at");
CREATE INDEX "gift_card_redemption_attempts_user_id_created_at_idx"
  ON "gift_card_redemption_attempts"("user_id", "created_at");
CREATE INDEX "gift_card_redemption_attempts_device_id_created_at_idx"
  ON "gift_card_redemption_attempts"("device_id", "created_at");
CREATE INDEX "gift_card_redemption_attempts_blocked_until_idx"
  ON "gift_card_redemption_attempts"("blocked_until");
CREATE INDEX "gift_card_redemption_attempts_gift_card_code_idx"
  ON "gift_card_redemption_attempts"("gift_card_code");

ALTER TABLE "gift_card_redemption_attempts"
  ADD CONSTRAINT "gift_card_redemption_attempts_gift_card_id_fkey"
  FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaigns" ADD COLUMN "max_redemptions_per_user" INTEGER NOT NULL DEFAULT 1;
