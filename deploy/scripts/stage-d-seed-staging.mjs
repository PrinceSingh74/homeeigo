/** Stage D minimal staging seed — idempotent fixtures + membership schema orphans for entitlement path. */
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const p = new PrismaClient();
const TAG = "stage_d_seed_v1";

const DDL = [
  `DO $$ BEGIN CREATE TYPE "SubscriptionInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS membership_plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'premium',
    interval "SubscriptionInterval" NOT NULL, price INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
    description TEXT, is_active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS membership_plans_is_active_idx ON membership_plans(is_active)`,
  `CREATE TABLE IF NOT EXISTS subscription_benefits (
    id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, quota_limit INTEGER, quota_period TEXT,
    type TEXT, value DOUBLE PRECISION)`,
  `CREATE INDEX IF NOT EXISTS subscription_benefits_plan_id_idx ON subscription_benefits(plan_id)`,
  `CREATE TABLE IF NOT EXISTS user_subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan_id TEXT NOT NULL REFERENCES membership_plans(id),
    status "SubscriptionStatus" NOT NULL DEFAULT 'PENDING', starts_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    auto_renew BOOLEAN NOT NULL DEFAULT false, cancelled_at TIMESTAMPTZ, razorpay_order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS user_subscriptions_user_id_idx ON user_subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx ON user_subscriptions(status)`,
  `CREATE INDEX IF NOT EXISTS user_subscriptions_plan_id_idx ON user_subscriptions(plan_id)`,
  `CREATE TABLE IF NOT EXISTS membership_benefit_usage (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), benefit_type TEXT NOT NULL, period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, benefit_type, period))`,
  `CREATE INDEX IF NOT EXISTS membership_benefit_usage_user_id_idx ON membership_benefit_usage(user_id)`,
  `CREATE INDEX IF NOT EXISTS membership_benefit_usage_benefit_type_idx ON membership_benefit_usage(benefit_type)`,
];

async function ensureMembershipSchema() {
  for (const sql of DDL) await p.$executeRawUnsafe(sql);
  await p.$executeRawUnsafe(
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false`,
  );
  await p.$executeRawUnsafe(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await p.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS journal_entry_number_seq`);
  await p.$executeRawUnsafe(
    `SELECT setval('journal_entry_number_seq', GREATEST(COALESCE((SELECT MAX(CAST(SUBSTRING(entry_number FROM 'JE-([0-9]+)') AS BIGINT)) FROM journal_entries), 0), 1))`,
  );
  console.log(JSON.stringify({ membershipSchema: "ready" }));
}

async function main() {
  await ensureMembershipSchema();

  const existing = await p.$queryRaw`
    SELECT id FROM users WHERE email = 'stage-d-customer@homigo-staging.test' LIMIT 1`;
  if (existing[0]?.id) {
    console.log(JSON.stringify({ seeded: false, reason: "already exists", customerId: existing[0].id }));
    await ensureProviderMatch("prov_stage_d_seed_v1");
    await p.$disconnect();
    return;
  }

  const customerId = `usr_${TAG}`;
  const providerUserId = `usr_${TAG}_prov`;
  const providerId = `prov_${TAG}`;
  const addressId = `addr_${TAG}`;
  const serviceId = `svc_${TAG}`;
  const locId = `loc_${TAG}`;

  await p.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${customerId}, 'stage-d-customer@homigo-staging.test', '+919999900001', 'Stage', 'Customer', 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await p.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${providerUserId}, 'stage-d-provider@homigo-staging.test', '+919999900002', 'Stage', 'Partner', 'VENDOR'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await p.$executeRaw`
    INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
    VALUES (${addressId}, ${customerId}, 'Home', 'Stage D Test Address', 'Delhi', 'Delhi', '110001', 'IN', 'Stage D Test Address, Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
  await p.$executeRaw`
    INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
    VALUES (${serviceId}, 'Stage D Deep Cleaning', 'stage-d-deep-cleaning', 'Stage D certification service', 'cleaning', 500, 120, true, NOW(), NOW())`;
  await p.$executeRaw`
    INSERT INTO providers (id, user_id, is_active, is_approved, is_online, rating, created_at, updated_at)
    VALUES (${providerId}, ${providerUserId}, true, true, true, 4.8, NOW(), NOW())`;
  await p.$executeRaw`
    INSERT INTO locations (id, provider_id, latitude, longitude, last_updated)
    VALUES (${locId}, ${providerId}, 28.6140, 77.2091, NOW())`;

  console.log(JSON.stringify({ seeded: true, customerId, providerId, addressId, serviceId, tag: TAG }));
  await ensureProviderMatch(providerId);
  await p.$disconnect();
}

async function ensureProviderMatch(providerId) {
  await p.$executeRawUnsafe(`
    UPDATE providers
    SET service_categories = ARRAY['cleaning', 'stage-d-deep-cleaning']::text[]
    WHERE id = '${providerId}'`);
  console.log(JSON.stringify({ providerMatch: "ready", providerId }));
}

main().catch((e) => { console.error(e); process.exit(1); });
