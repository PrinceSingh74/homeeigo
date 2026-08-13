-- Encrypted-at-rest copy of the start PIN so the booking owner can view it
-- in the customer app (Urban-Company style). Partner never receives it.
ALTER TABLE "booking_start_otps" ADD COLUMN "otp_ciphertext" TEXT;
