-- P3 Part B: Access token revocation + refresh token family tracking

CREATE TYPE "TokenRevocationReason" AS ENUM (
  'LOGOUT',
  'PASSWORD_RESET',
  'ACCOUNT_DELETION',
  'ADMIN_FORCE_LOGOUT',
  'SUSPICIOUS_ACTIVITY',
  'DEVICE_REVOCATION',
  'MANUAL_REVOCATION',
  'REUSE_ATTACK_DETECTED',
  'ROTATION'
);

CREATE TABLE "token_blacklist" (
  "id" TEXT NOT NULL,
  "token_jti" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "revoked_by" TEXT NOT NULL,
  "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" "TokenRevocationReason" NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,

  CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_auth_epochs" (
  "user_id" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_auth_epochs_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "parent_token_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_reason" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "created_by" TEXT DEFAULT 'LOGIN';

CREATE UNIQUE INDEX "token_blacklist_token_jti_key" ON "token_blacklist"("token_jti");
CREATE INDEX "token_blacklist_user_id_idx" ON "token_blacklist"("user_id");
CREATE INDEX "token_blacklist_expires_at_idx" ON "token_blacklist"("expires_at");

ALTER TABLE "token_blacklist"
  ADD CONSTRAINT "token_blacklist_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_auth_epochs"
  ADD CONSTRAINT "user_auth_epochs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "refresh_tokens_user_id_family_id_idx" ON "refresh_tokens"("user_id", "family_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_parent_token_id_fkey"
  FOREIGN KEY ("parent_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
