-- Service-start verification PIN ("start OTP")
-- Gate for POST /bookings/:id/start: the customer receives a 6-digit code
-- (in-app / email / SMS) and the partner must submit it before starting.

-- AlterTable: audit anchor on bookings
ALTER TABLE "bookings" ADD COLUMN "start_otp_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "booking_start_otps" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMP(3),
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_start_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_start_otps_booking_id_created_at_idx" ON "booking_start_otps"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_start_otps_expires_at_idx" ON "booking_start_otps"("expires_at");

-- AddForeignKey
ALTER TABLE "booking_start_otps" ADD CONSTRAINT "booking_start_otps_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
