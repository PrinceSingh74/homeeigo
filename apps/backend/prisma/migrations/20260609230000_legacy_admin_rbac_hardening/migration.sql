-- Data migration: provision AdminUser rows for legacy ADMIN accounts (idempotent).
-- Application no longer grants implicit super-admin to User.role=ADMIN without a profile.

INSERT INTO "admin_users" ("id", "user_id", "role_id", "is_active", "granted_by", "granted_at", "login_attempts")
SELECT
  gen_random_uuid()::text,
  u."id",
  r."id",
  true,
  'LEGACY_MIGRATION',
  NOW(),
  0
FROM "users" u
INNER JOIN "admin_roles" r ON r."name" = 'SUPER_ADMIN'
WHERE u."role" = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM "admin_users" au WHERE au."user_id" = u."id"
  );
