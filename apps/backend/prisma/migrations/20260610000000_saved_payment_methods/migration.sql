-- Saved payment methods (non-sensitive metadata only — no PAN/CVV/expiry)

CREATE TYPE "saved_payment_method_type" AS ENUM ('CARD', 'UPI', 'BANK');

CREATE TABLE "saved_payment_methods" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "saved_payment_method_type" NOT NULL,
  "label" TEXT NOT NULL,
  "last4" TEXT,
  "network" TEXT,
  "upi_handle" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_payment_methods_user_id_idx" ON "saved_payment_methods"("user_id");
CREATE INDEX "saved_payment_methods_user_id_is_default_idx" ON "saved_payment_methods"("user_id", "is_default");

ALTER TABLE "saved_payment_methods"
  ADD CONSTRAINT "saved_payment_methods_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
