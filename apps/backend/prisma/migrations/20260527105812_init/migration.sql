-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'VENDOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_USER', 'CANCELLED_BY_PROVIDER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('NOT_DONE', 'PENDING', 'CLEARED', 'FAILED');

-- CreateEnum
CREATE TYPE "TrackingStatus" AS ENUM ('NOT_STARTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('CREDIT', 'DEBIT', 'BONUS', 'REFUND', 'WITHDRAWAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "WalletTxnStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "profile_image" TEXT,
    "bio" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "gender" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "password" TEXT NOT NULL,
    "password_changed_at" TIMESTAMP(3),
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "banned_reason" TEXT,
    "banned_at" TIMESTAMP(3),
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "kyc_document_url" TEXT,
    "kyc_document_type" TEXT,
    "kyc_document_number" TEXT,
    "kyc_verified_at" TIMESTAMP(3),
    "kyc_rejection_reason" TEXT,
    "default_address_id" TEXT,
    "preferred_city" TEXT,
    "default_language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "dark_mode" BOOLEAN NOT NULL DEFAULT false,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications" BOOLEAN NOT NULL DEFAULT true,
    "sms_notifications" BOOLEAN NOT NULL DEFAULT true,
    "wallet_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wallet_currency" TEXT NOT NULL DEFAULT 'INR',
    "total_spent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_saved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referral_code" TEXT,
    "referred_by" TEXT,
    "referral_count" INTEGER NOT NULL DEFAULT 0,
    "referral_bonus_used" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_name" TEXT,
    "business_license" TEXT,
    "tax_id" TEXT,
    "service_categories" TEXT[],
    "service_regions" TEXT[],
    "bio" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_date" TIMESTAMP(3),
    "verification_notes" TEXT,
    "certifications" TEXT[],
    "background_check_status" "BackgroundCheckStatus" NOT NULL DEFAULT 'NOT_DONE',
    "background_check_date" TIMESTAMP(3),
    "profile_image" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "rating_breakdown" TEXT,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "completed_bookings" INTEGER NOT NULL DEFAULT 0,
    "cancelled_bookings" INTEGER NOT NULL DEFAULT 0,
    "rejected_bookings" INTEGER NOT NULL DEFAULT 0,
    "completion_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "response_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancellation_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "on_time_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptance_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_response_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_completion_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "online_since" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "current_status" TEXT NOT NULL DEFAULT 'offline',
    "working_hours_start" TEXT,
    "working_hours_end" TEXT,
    "working_days" TEXT[],
    "wallet_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "this_month_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "this_week_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "bank_account_holder" TEXT,
    "bank_account_number" TEXT,
    "bank_ifsc_code" TEXT,
    "bank_name" TEXT,
    "payment_method_preference" TEXT NOT NULL DEFAULT 'bank_transfer',
    "upi_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "banned_reason" TEXT,
    "banned_at" TIMESTAMP(3),
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "approval_notes" TEXT,
    "push_tokens" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detailed_description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "base_price" DOUBLE PRECISION NOT NULL,
    "min_price" DOUBLE PRECISION,
    "max_price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "estimated_duration" INTEGER NOT NULL,
    "duration_range" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "is_promoted" BOOLEAN NOT NULL DEFAULT false,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "booking_count" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "images" TEXT[],
    "thumbnail" TEXT,
    "included_services" TEXT[],
    "excluded_services" TEXT[],
    "requirements" TEXT[],
    "available_cities" TEXT[],
    "unavailable_cities" TEXT[],
    "tags" TEXT[],
    "seo_title" TEXT,
    "seo_description" TEXT,
    "seo_keywords" TEXT,
    "pricing_model" TEXT NOT NULL DEFAULT 'fixed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "full_address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "place_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'residential',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_billing_address" BOOLEAN NOT NULL DEFAULT false,
    "landmark" TEXT,
    "building_name" TEXT,
    "flat_number" TEXT,
    "special_instructions" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT,
    "service_id" TEXT NOT NULL,
    "address_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "scheduled_time" TEXT,
    "accepted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "estimated_duration" INTEGER,
    "actual_duration" INTEGER,
    "eta" INTEGER,
    "description" TEXT,
    "user_notes" TEXT,
    "provider_notes" TEXT,
    "base_amount" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coupon_code" TEXT,
    "taxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "final_amount" DOUBLE PRECISION NOT NULL,
    "tip_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payment_method" TEXT,
    "cancellation_reason" TEXT,
    "cancelled_by" TEXT,
    "refund_status" TEXT,
    "refund_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_method" TEXT NOT NULL,
    "razorpay_order_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT,
    "razorpay_signature" TEXT,
    "razorpay_error_code" TEXT,
    "razorpay_error_description" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "refunded_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refund_reason" TEXT,
    "razorpay_refund_id" TEXT,
    "refund_status" TEXT,
    "receipt_url" TEXT,
    "invoice_number" TEXT,
    "metadata" TEXT,
    "notes" TEXT,
    "settled_at" TIMESTAMP(3),
    "settlement_id" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review_text" TEXT,
    "short_review" TEXT,
    "rating_breakdown" TEXT,
    "liked" TEXT[],
    "could_improve" TEXT[],
    "photos" TEXT[],
    "videos" TEXT[],
    "tip_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "unhelpful_count" INTEGER NOT NULL DEFAULT 0,
    "provider_response" TEXT,
    "responded_at" TIMESTAMP(3),
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "status" "TrackingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "estimated_arrival_time" TIMESTAMP(3),
    "actual_arrival_time" TIMESTAMP(3),
    "estimated_start_time" TIMESTAMP(3),
    "actual_start_time" TIMESTAMP(3),
    "estimated_end_time" TIMESTAMP(3),
    "actual_end_time" TIMESTAMP(3),
    "total_distance" DOUBLE PRECISION,
    "total_duration" INTEGER,
    "start_latitude" DOUBLE PRECISION,
    "start_longitude" DOUBLE PRECISION,
    "end_latitude" DOUBLE PRECISION,
    "end_longitude" DOUBLE PRECISION,
    "last_update_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_history" (
    "id" TEXT NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "transaction_number" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "wallet_balance_before" DOUBLE PRECISION NOT NULL,
    "wallet_balance_after" DOUBLE PRECISION NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "status" "WalletTxnStatus" NOT NULL DEFAULT 'COMPLETED',
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "gross_amount" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "net_earning" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'credited',
    "earning_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "withdrawal_number" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "processing_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "ifsc_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "failure_reason" TEXT,
    "razorpay_payout_id" TEXT,
    "razorpay_status" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "data" TEXT,
    "image_url" TEXT,
    "action_url" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "is_pushed" BOOLEAN NOT NULL DEFAULT false,
    "pushed_at" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "device_name" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_documents" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verification_notes" TEXT,
    "expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "booking_id" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "attachments" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "booking_id" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_password_reset_token_key" ON "users"("password_reset_token");

-- CreateIndex
CREATE UNIQUE INDEX "users_kyc_document_number_key" ON "users"("kyc_document_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_phone_number_idx" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "users_kyc_status_idx" ON "users"("kyc_status");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_is_banned_idx" ON "users"("is_banned");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_referral_code_idx" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "providers_user_id_key" ON "providers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_business_license_key" ON "providers"("business_license");

-- CreateIndex
CREATE UNIQUE INDEX "providers_tax_id_key" ON "providers"("tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_bank_account_number_key" ON "providers"("bank_account_number");

-- CreateIndex
CREATE UNIQUE INDEX "providers_upi_id_key" ON "providers"("upi_id");

-- CreateIndex
CREATE INDEX "providers_is_online_idx" ON "providers"("is_online");

-- CreateIndex
CREATE INDEX "providers_rating_idx" ON "providers"("rating");

-- CreateIndex
CREATE INDEX "providers_is_verified_idx" ON "providers"("is_verified");

-- CreateIndex
CREATE INDEX "providers_is_approved_idx" ON "providers"("is_approved");

-- CreateIndex
CREATE INDEX "providers_is_active_idx" ON "providers"("is_active");

-- CreateIndex
CREATE INDEX "providers_completion_rate_idx" ON "providers"("completion_rate");

-- CreateIndex
CREATE INDEX "providers_created_at_idx" ON "providers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_category_idx" ON "services"("category");

-- CreateIndex
CREATE INDEX "services_is_active_idx" ON "services"("is_active");

-- CreateIndex
CREATE INDEX "services_is_featured_idx" ON "services"("is_featured");

-- CreateIndex
CREATE INDEX "services_popularity_idx" ON "services"("popularity");

-- CreateIndex
CREATE INDEX "services_slug_idx" ON "services"("slug");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "addresses_city_idx" ON "addresses"("city");

-- CreateIndex
CREATE INDEX "addresses_is_default_idx" ON "addresses"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_number_key" ON "bookings"("booking_number");

-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "bookings_provider_id_idx" ON "bookings"("provider_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_scheduled_date_idx" ON "bookings"("scheduled_date");

-- CreateIndex
CREATE INDEX "bookings_payment_status_idx" ON "bookings"("payment_status");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE INDEX "bookings_booking_number_idx" ON "bookings"("booking_number");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_provider_id_status_idx" ON "bookings"("provider_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_key" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_order_id_key" ON "payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_payment_id_key" ON "payments"("razorpay_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_refund_id_key" ON "payments"("razorpay_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoice_number_key" ON "payments"("invoice_number");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_razorpay_order_id_idx" ON "payments"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_booking_id_key" ON "ratings"("booking_id");

-- CreateIndex
CREATE INDEX "ratings_user_id_idx" ON "ratings"("user_id");

-- CreateIndex
CREATE INDEX "ratings_provider_id_idx" ON "ratings"("provider_id");

-- CreateIndex
CREATE INDEX "ratings_rating_idx" ON "ratings"("rating");

-- CreateIndex
CREATE INDEX "ratings_created_at_idx" ON "ratings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_booking_id_key" ON "tracking"("booking_id");

-- CreateIndex
CREATE INDEX "tracking_status_idx" ON "tracking"("status");

-- CreateIndex
CREATE INDEX "location_history_tracking_id_idx" ON "location_history"("tracking_id");

-- CreateIndex
CREATE INDEX "location_history_provider_id_idx" ON "location_history"("provider_id");

-- CreateIndex
CREATE INDEX "location_history_timestamp_idx" ON "location_history"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "locations_provider_id_key" ON "locations"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_transaction_number_key" ON "wallet_transactions"("transaction_number");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_idx" ON "wallet_transactions"("user_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_provider_id_idx" ON "wallet_transactions"("provider_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_idx" ON "wallet_transactions"("type");

-- CreateIndex
CREATE INDEX "wallet_transactions_status_idx" ON "wallet_transactions"("status");

-- CreateIndex
CREATE INDEX "wallet_transactions_created_at_idx" ON "wallet_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_booking_id_key" ON "earnings"("booking_id");

-- CreateIndex
CREATE INDEX "earnings_provider_id_idx" ON "earnings"("provider_id");

-- CreateIndex
CREATE INDEX "earnings_earning_date_idx" ON "earnings"("earning_date");

-- CreateIndex
CREATE INDEX "earnings_payment_status_idx" ON "earnings"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_withdrawal_number_key" ON "withdrawals"("withdrawal_number");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_razorpay_payout_id_key" ON "withdrawals"("razorpay_payout_id");

-- CreateIndex
CREATE INDEX "withdrawals_provider_id_idx" ON "withdrawals"("provider_id");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "withdrawals_requested_at_idx" ON "withdrawals"("requested_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_provider_id_idx" ON "notifications"("provider_id");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "provider_documents_provider_id_idx" ON "provider_documents"("provider_id");

-- CreateIndex
CREATE INDEX "provider_documents_document_type_idx" ON "provider_documents"("document_type");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_ticket_number_idx" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "support_tickets_provider_id_idx" ON "support_tickets"("provider_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_provider_id_idx" ON "activity_logs"("provider_id");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "tracking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
