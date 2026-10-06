-- services: a new row is a DRAFT, not a live service (Phase 14 governance, 2026-10-06).
--
-- Defect: the column defaults made every row inserted without explicit values ACTIVE, active,
-- customer-visible and bookable. Any insert that did not go through the admin flow — a seed
-- script, a certification script, a manual INSERT — therefore put a service in front of customers
-- with no publish gate, no second admin's approval, no version row and no audit entry. Application
-- code cannot stop a database write; the default was the cause.
--
-- Fix: the four defaults become the unpublished state. The admin flow already writes all four
-- explicitly on every transition (catalog.service: create lands on DRAFT, transition() sets the
-- flags for the target lifecycle), so nothing that goes through it changes.
--
-- Defaults only. No existing row is read or written: every service that is live stays live.

ALTER TABLE "services" ALTER COLUMN "lifecycle_status" SET DEFAULT 'DRAFT';
ALTER TABLE "services" ALTER COLUMN "is_active" SET DEFAULT false;
ALTER TABLE "services" ALTER COLUMN "is_customer_visible" SET DEFAULT false;
ALTER TABLE "services" ALTER COLUMN "is_bookable" SET DEFAULT false;
