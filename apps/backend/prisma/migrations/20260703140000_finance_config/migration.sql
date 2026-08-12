-- Finance Intelligence config — additive CFO inputs with immutable history.
CREATE TABLE "finance_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_config_key_key" ON "finance_config"("key");

CREATE TABLE "finance_config_history" (
    "id" TEXT NOT NULL,
    "config_key" TEXT NOT NULL,
    "value_before" DOUBLE PRECISION,
    "value_after" DOUBLE PRECISION NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_config_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_config_history_config_key_idx" ON "finance_config_history"("config_key");
CREATE INDEX "finance_config_history_created_at_idx" ON "finance_config_history"("created_at");
CREATE INDEX "finance_config_history_changed_by_idx" ON "finance_config_history"("changed_by");
