-- registeredAt means "application submitted", not "provider row created".
-- The NOT NULL DEFAULT now() made every saveServices workspace look submitted.

ALTER TABLE "providers" ALTER COLUMN "registered_at" DROP DEFAULT;
ALTER TABLE "providers" ALTER COLUMN "registered_at" DROP NOT NULL;

UPDATE "providers" AS p
SET "registered_at" = NULL
WHERE p."is_approved" = false
  AND p."registration_status" = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM "partner_registration_sessions" AS s
    WHERE s."provider_id" = p."id"
      AND s."status" = 'ACTIVE'
  );
