-- P3 Enterprise Hardening: Scoped Admin RBAC (new tables only, migration-safe)

CREATE TYPE "AdminRoleType" AS ENUM (
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'OPERATIONS_ADMIN',
  'SUPPORT_ADMIN',
  'MARKETING_ADMIN',
  'ANALYTICS_ADMIN'
);

CREATE TYPE "AdminResource" AS ENUM (
  'USERS',
  'PAYMENTS',
  'WALLET',
  'BOOKINGS',
  'DISPUTES',
  'CAMPAIGNS',
  'GIFT_CARDS',
  'MEMBERSHIPS',
  'ANALYTICS',
  'SETTINGS',
  'AUDIT_LOGS',
  'ADMIN_USERS'
);

CREATE TYPE "AdminAction" AS ENUM (
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'EXPORT',
  'IMPERSONATE',
  'FORCE_LOGOUT'
);

CREATE TABLE "admin_roles" (
  "id" TEXT NOT NULL,
  "name" "AdminRoleType" NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,

  CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_permissions" (
  "id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "resource" "AdminResource" NOT NULL,
  "action" "AdminAction" NOT NULL,
  "scope" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_users" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_login" TIMESTAMP(3),
  "login_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "granted_by" TEXT NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by" TEXT,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");
CREATE INDEX "admin_roles_name_idx" ON "admin_roles"("name");

CREATE UNIQUE INDEX "admin_permissions_role_id_resource_action_key"
  ON "admin_permissions"("role_id", "resource", "action");
CREATE INDEX "admin_permissions_role_id_idx" ON "admin_permissions"("role_id");

CREATE UNIQUE INDEX "admin_users_user_id_key" ON "admin_users"("user_id");
CREATE INDEX "admin_users_role_id_idx" ON "admin_users"("role_id");
CREATE INDEX "admin_users_is_active_idx" ON "admin_users"("is_active");

ALTER TABLE "admin_permissions"
  ADD CONSTRAINT "admin_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
